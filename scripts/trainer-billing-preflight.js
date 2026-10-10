#!/usr/bin/env node
// Chequeo previo de la facturación de Trainers, para ejecutar en el servidor ANTES de poner
// STRIPE_KEY en marcha (o tras cambiarla): `npm run billing:preflight`.
// Lee la configuración del entorno, comprueba contra Stripe el catálogo (precios por lookup key),
// el portal, el webhook y Managed Payments, y no imprime nunca claves ni secretos. No modifica
// nada ni en Stripe ni en la base de datos.
const fs = require("fs");
const path = require("path");

const buildDir = path.join(__dirname, "../.build/trainer-billing");
const results = [];
const ok = (name, detail = "") => results.push({ level: "ok", name, detail });
const fail = (name, detail = "") => results.push({ level: "fail", name, detail });
// Aviso: no bloquea (algo que la clave no puede leer y hay que mirar en el Dashboard).
const warn = (name, detail = "") => results.push({ level: "warn", name, detail });
const permission = (error) => error && (error.code === "more_permissions_required" || error.statusCode === 403);
const NAMES = { free: "Free", starter: "Inicio", professional: "Profesional", scale: "Escala" };

async function main() {
  if (!fs.existsSync(path.join(buildDir, "runtime.js"))) {
    fail("Módulo compilado", "Falta .build/trainer-billing: ejecuta `npm run build:trainer-billing`.");
    return;
  }
  ok("Módulo compilado");
  // Mismo cargador que el servidor: .env si existe, sin sobrescribir el entorno.
  try { require("dotenv").config({ path: path.resolve(__dirname, "../.env") }); } catch { /* entorno ya cargado por PM2 */ }
  const { loadConfig, API_VERSION } = require(path.join(buildDir, "config"));
  const { catalogPrices } = require(path.join(buildDir, "catalog"));
  const { StripeGateway, SUPPORTED_EVENT_TYPES } = require(path.join(buildDir, "stripe-gateway"));
  const config = loadConfig();
  if (!config.enabled) {
    fail("Configuración", "sin STRIPE_KEY la facturación está apagada");
    return;
  }
  const live = config.mode === "live";
  const strict = live ? fail : warn;
  ok("Modo", live ? "real" : "sandbox");
  if (config.errors.length) {
    fail("Configuración", config.errors.join(", "));
    return;
  }
  ok("Configuración", "sin errores");
  (config.supportEmail ? ok : strict)("Buzón de facturación", config.supportEmail || "STRIPE_SUPPORT_EMAIL vacío");
  (config.termsUrl ? ok : strict)("Condiciones de contratación", config.termsUrl || "STRIPE_TERMS_URL vacío: Checkout no pedirá aceptarlas");
  const gateway = new StripeGateway(config);
  const stripe = gateway.stripe;

  try {
    const account = await stripe.accounts.retrieve();
    const ready = account.charges_enabled && account.payouts_enabled && !(account.requirements?.currently_due || []).length;
    (ready ? ok : fail)("Cuenta de Stripe", ready ? "cobros y transferencias activos, sin requisitos pendientes"
      : "faltan requisitos: revisa Configuración → Datos de la empresa y el banner de activación");
  } catch (error) {
    if (!permission(error)) throw error;
    warn("Cuenta de Stripe", "la clave no puede leer la cuenta: comprueba en el Dashboard que los cobros y las transferencias están activos");
  }

  // Lecturas que el backend necesita para reembolsos, disputas, avisos de fraude y recuperación de eventos.
  const reads = {
    "cargos": () => stripe.charges.list({ limit: 1 }),
    "reembolsos": () => stripe.refunds.list({ limit: 1 }),
    "disputas": () => stripe.disputes.list({ limit: 1 }),
    "avisos de fraude (Radar)": () => stripe.radar.earlyFraudWarnings.list({ limit: 1 }),
    "pagos de factura": () => stripe.invoicePayments.list({ limit: 1 }),
    "eventos": () => stripe.events.list({ limit: 1 }),
  };
  const missing = [];
  for (const [name, read] of Object.entries(reads)) {
    try { await read(); } catch (error) { if (permission(error)) missing.push(name); else throw error; }
  }
  (missing.length ? fail : ok)("Permisos de lectura", missing.length ? `la clave no puede leer: ${missing.join(", ")}` : "cargos, reembolsos, disputas, avisos de fraude, pagos de factura y eventos");

  // Escrituras que necesitan contratar, cambiar de plan y cancelar. Se prueban sobre un identificador que
  // no existe: «no existe» (resource_missing) prueba el permiso sin modificar nada; 403, que falta.
  // Sin escritura en suscripciones, contratar funciona pero cambiar de plan o cancelar falla (09/10/2026).
  const probe = "trainfit_preflight_probe";
  const writes = {
    "clientes": () => stripe.customers.update(`cus_${probe}`, {}),
    "sesiones de Checkout": () => stripe.checkout.sessions.expire(`cs_${config.mode}_${probe}`),
    "suscripciones": () => stripe.subscriptions.update(`sub_${probe}`, {}),
    "calendarios de suscripción": () => stripe.subscriptionSchedules.release(`sub_sched_${probe}`),
    "facturas": () => stripe.invoices.voidInvoice(`in_${probe}`),
    // Sin este permiso el portal no abre (10/10/2026, en local) aunque la configuración se lea bien.
    "sesiones del portal": () => stripe.billingPortal.sessions.create({ customer: `cus_${probe}` }),
  };
  const cannotWrite = [];
  const unconfirmed = [];
  for (const [name, write] of Object.entries(writes)) {
    try { await write(); unconfirmed.push(name); } catch (error) {
      if (permission(error)) cannotWrite.push(name);
      else if (error?.code !== "resource_missing") unconfirmed.push(name);
    }
  }
  if (cannotWrite.length) fail("Permisos de escritura", `la clave no puede escribir: ${cannotWrite.join(", ")} (Desarrolladores → Claves de API → la clave restringida)`);
  else if (unconfirmed.length) warn("Permisos de escritura", `no se pudo confirmar: ${unconfirmed.join(", ")}; revísalo en el Dashboard`);
  else ok("Permisos de escritura", "clientes, Checkout, suscripciones, calendarios, facturas y portal (comprobado sin modificar nada)");

  // Con condiciones, Checkout exige aceptarlas y Stripe rechaza abrir el pago si la URL no está también en los
  // datos públicos de la cuenta (09/10/2026, en PRE). La API no permite leerla: se confirma a mano.
  if (config.termsUrl) {
    warn("Condiciones en los datos públicos", `Configuración → Datos públicos → «Condiciones del servicio» debe ser ${config.termsUrl}; sin ella Checkout no se abre`);
  }

  // Catálogo: cada pieza a la venta debe existir con su lookup key y el importe del catálogo.
  for (const entry of catalogPrices()) {
    const label = `${entry.kind === "base" ? "Cuota" : "Plaza adicional"} ${NAMES[entry.tier]} ${entry.interval === "annual" ? "anual" : "mensual"}`;
    try {
      await gateway.validateState({ tier: entry.tier, interval: entry.interval, extraSeats: entry.kind === "seat" ? 1 : 0 });
      ok(label, `${(entry.amount / 100).toFixed(2)} € + IVA`);
    } catch (error) {
      fail(label, `${error.code || "no coincide con el catálogo"}: ejecuta \`npm run stripe:catalog\``);
    }
  }

  try {
    const configuration = (await stripe.billingPortal.configurations.list({ is_default: true, active: true, limit: 1 })).data[0];
    if (!configuration) throw Object.assign(new Error("missing"), { code: "sin configuración predeterminada" });
    const features = configuration.features;
    const problems = [];
    if (configuration.livemode !== live) problems.push("del mismo modo");
    if (features.subscription_update?.enabled) problems.push("cambios de plan DESACTIVADOS");
    if (!features.invoice_history?.enabled) problems.push("historial de facturas");
    if (!features.payment_method_update?.enabled) problems.push("actualizar método de pago");
    if (!features.subscription_cancel?.enabled || features.subscription_cancel.mode !== "at_period_end") problems.push("cancelar al final del periodo");
    if (!configuration.business_profile?.terms_of_service_url || !configuration.business_profile?.privacy_policy_url) problems.push("enlaces a condiciones y privacidad");
    (problems.length ? fail : ok)("Portal de clientes (predeterminado)", problems.length ? `debe tener: ${problems.join("; ")}`
      : "facturas, tarjeta y cancelación a fin de periodo; sin cambios de plan");
  } catch (error) {
    fail("Portal de clientes", error.code || "no se pudo leer la configuración del portal");
  }

  try {
    const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data
      .filter((endpoint) => endpoint.status === "enabled" && endpoint.url.endsWith("/api/billing/webhooks/stripe"));
    if (endpoints.length !== 1) {
      strict("Webhook", endpoints.length ? "hay más de un destino activo hacia la API: deja solo uno" : "no hay un destino activo hacia /api/billing/webhooks/stripe");
    } else {
      const [endpoint] = endpoints;
      const events = endpoint.enabled_events || [];
      const absent = events.includes("*") ? [] : SUPPORTED_EVENT_TYPES.filter((type) => !events.includes(type));
      const problems = [];
      if (live && !endpoint.url.startsWith("https://")) problems.push("URL https");
      if (absent.length) problems.push(`faltan eventos: ${absent.join(", ")}`);
      if (endpoint.api_version && endpoint.api_version !== API_VERSION) problems.push(`versión de API ${API_VERSION} (tiene ${endpoint.api_version})`);
      (problems.length ? fail : ok)("Webhook", problems.length ? problems.join("; ") : `${events.length} eventos, API ${endpoint.api_version || "de la cuenta"}`);
    }
  } catch (error) {
    if (!permission(error)) fail("Webhook", error.code || "no se pudo leer los destinos de webhook");
    else strict("Webhook", "la clave no puede leer los webhooks: comprueba en el Dashboard la URL, los eventos y la versión de API");
  }

  // Sin API para leer su estado: se confirma en el Dashboard. Sin activarlo, Checkout falla al crear la sesión.
  warn("Managed Payments", "Stripe vende como comerciante registrado y gestiona el IVA. Confirma en Configuración → Managed Payments " +
    "el estado «Listo para usar» o «Activo» y que los productos de TrainFit Trainers «cumplen los requisitos»");
}

main().catch((error) => fail("Error inesperado", error.code || error.name)).finally(() => {
  const mark = { ok: "✔", fail: "✘", warn: "!" };
  for (const row of results) console.log(`${mark[row.level]} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
  const failed = results.filter((row) => row.level === "fail").length;
  const warned = results.filter((row) => row.level === "warn").length;
  if (failed) console.log(`\n${failed} comprobación(es) fallida(s): no pongas la facturación en marcha todavía.`);
  else console.log(warned ? `\nSin fallos. Revisa a mano los ${warned} aviso(s) (!) en el Dashboard.`
    : "\nTodo correcto.");
  process.exitCode = failed ? 1 : 0;
});
