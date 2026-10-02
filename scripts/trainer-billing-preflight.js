#!/usr/bin/env node
// Chequeo previo de la facturación de Trainers, para ejecutar en el servidor
// ANTES de poner TRAINER_BILLING_ENABLED=1: `npm run billing:preflight`.
// Lee la configuración del entorno, comprueba contra Stripe el catálogo, el
// portal, los métodos de pago, el webhook y la política fiscal, y no imprime
// nunca claves ni secretos. No modifica nada ni en Stripe ni en la base de datos.
const fs = require("fs");
const path = require("path");

const buildDir = path.join(__dirname, "../.build/trainer-billing");
const results = [];
const ok = (name, detail = "") => results.push({ level: "ok", name, detail });
const fail = (name, detail = "") => results.push({ level: "fail", name, detail });
// Aviso: no bloquea (algo que la clave no puede leer y hay que mirar en el Dashboard).
const warn = (name, detail = "") => results.push({ level: "warn", name, detail });
const permission = (error) => error && (error.code === "more_permissions_required" || error.statusCode === 403);
// Métodos aprobados el 28/09/2026 (SEPA, en una segunda fase).
const ALLOWED_METHODS = new Set(["card", "apple_pay", "google_pay", "link"]);

async function main() {
  if (!fs.existsSync(path.join(buildDir, "runtime.js"))) {
    fail("Módulo compilado", "Falta .build/trainer-billing: ejecuta `npm run build:trainer-billing`.");
    return;
  }
  ok("Módulo compilado");
  // Mismo cargador que el servidor: .env si existe, sin sobrescribir el entorno.
  try { require("dotenv").config(); } catch { /* entorno ya cargado por PM2 */ }
  const { loadConfig, API_VERSION } = require(path.join(buildDir, "config"));
  const { StripeGateway, SUPPORTED_EVENT_TYPES } = require(path.join(buildDir, "stripe-gateway"));
  const config = loadConfig({ ...process.env, TRAINER_BILLING_ENABLED: "1" });
  const live = config.mode === "live";
  const strict = live ? fail : warn;
  // Managed Payments (2026-10-01): Stripe es el vendedor registrado; elige los métodos de pago y gestiona el IVA.
  const managed = config.taxPolicy === "managed_payments";
  const vatOnTop = managed || config.taxPolicy === "stripe_tax";
  ok("Modo", config.mode);
  ok("Política fiscal", config.taxPolicy);
  if (config.errors.length) {
    fail("Configuración", config.errors.join(", "));
    return;
  }
  ok("Configuración", "sin errores");
  (config.supportEmail ? ok : strict)("Buzón de facturación", config.supportEmail || "TRAINER_BILLING_SUPPORT_EMAIL vacío");
  (config.termsUrl ? ok : strict)("Condiciones de contratación", config.termsUrl || "TRAINER_BILLING_TERMS_URL vacío: Checkout no pedirá aceptarlas");
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

  for (const plan of config.plans) {
    for (const price of Object.values(plan.prices)) {
      try {
        await gateway.validatePrice(price);
        ok(`Precio ${plan.tier} ${price.interval}`, `${(price.amount / 100).toFixed(2)} € ${vatOnTop ? "+ IVA" : ""}`);
      } catch (error) {
        fail(`Precio ${plan.tier} ${price.interval}`, error.code || "no coincide con el catálogo (importe, intervalo, modo o IVA)");
      }
    }
  }

  if (managed) {
    ok("Métodos de pago", "los elige Managed Payments (Stripe es el vendedor)");
    if (config.paymentMethodConfiguration) warn("Métodos de pago", "STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID no se usa con Managed Payments");
  } else if (config.paymentMethodConfiguration) {
    try {
      const pmc = await stripe.paymentMethodConfigurations.retrieve(config.paymentMethodConfiguration);
      const enabled = Object.entries(pmc).filter(([, value]) => value && typeof value === "object" && value.display_preference?.value === "on")
        .map(([key]) => key);
      const extra = enabled.filter((key) => !ALLOWED_METHODS.has(key));
      const valid = pmc.active && pmc.livemode === live && enabled.includes("card") && extra.length === 0;
      (valid ? ok : fail)("Métodos de pago", valid ? `activos: ${enabled.join(", ")}`
        : extra.length ? `desactiva en esta configuración: ${extra.join(", ")} (solo tarjeta, Apple Pay, Google Pay y Link)` : "la configuración debe estar activa y con tarjeta");
    } catch (error) {
      if (!permission(error)) fail("Métodos de pago", error.code || "no se pudo leer la configuración de métodos de pago");
      else strict("Métodos de pago", "la clave no puede leer la configuración de métodos de pago (permiso de lectura) o compruébala en el Dashboard");
    }
  } else strict("Métodos de pago", "sin STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: Checkout usa la configuración predeterminada de la cuenta");

  try {
    const configuration = await stripe.billingPortal.configurations.retrieve(config.portalConfiguration);
    const features = configuration.features;
    const updates = features.customer_update?.allowed_updates || [];
    const problems = [];
    if (!configuration.active || configuration.livemode !== live) problems.push("activa y del mismo modo");
    if (features.subscription_update?.enabled) problems.push("cambios de plan DESACTIVADOS");
    if (!features.invoice_history?.enabled) problems.push("historial de facturas");
    if (!features.payment_method_update?.enabled) problems.push("actualizar método de pago");
    if (!features.subscription_cancel?.enabled || features.subscription_cancel.mode !== "at_period_end") problems.push("cancelar al final del periodo");
    if (!features.customer_update?.enabled || !updates.includes("address") || !updates.includes("tax_id")) problems.push("editar dirección y NIF");
    if (!configuration.business_profile?.terms_of_service_url || !configuration.business_profile?.privacy_policy_url) problems.push("enlaces a condiciones y privacidad");
    if (!String(configuration.default_return_url || "").startsWith(config.frontendUrl)) problems.push(`URL de vuelta en ${config.frontendUrl}`);
    const pmc = features.payment_method_update?.payment_method_configuration;
    if (!managed && config.paymentMethodConfiguration && pmc !== config.paymentMethodConfiguration) problems.push("la misma configuración de métodos de pago que Checkout");
    (problems.length ? fail : ok)("Portal de clientes", problems.length ? `debe tener: ${problems.join("; ")}`
      : "facturas, tarjeta, datos fiscales y cancelación a fin de periodo; sin cambios de plan");
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
      const missing = events.includes("*") ? [] : SUPPORTED_EVENT_TYPES.filter((type) => !events.includes(type));
      const problems = [];
      if (live && !endpoint.url.startsWith("https://")) problems.push("URL https");
      if (missing.length) problems.push(`faltan eventos: ${missing.join(", ")}`);
      if (endpoint.api_version && endpoint.api_version !== API_VERSION) problems.push(`versión de API ${API_VERSION} (tiene ${endpoint.api_version})`);
      (problems.length ? fail : ok)("Webhook", problems.length ? problems.join("; ") : `${events.length} eventos, API ${endpoint.api_version || "de la cuenta"}`);
    }
  } catch (error) {
    if (!permission(error)) fail("Webhook", error.code || "no se pudo leer los destinos de webhook");
    else strict("Webhook", "la clave no puede leer los webhooks: comprueba en el Dashboard la URL, los eventos y la versión de API");
  }

  if (managed) {
    // Sin API para leer su estado: se confirma en el Dashboard. Sin activarlo, Checkout falla al crear la sesión.
    warn("Managed Payments", "Stripe gestiona el IVA (no hace falta registro propio). Confirma en Configuración → Managed Payments " +
      "el estado «Listo para usar» o «Activo» y que los 3 productos «cumplen los requisitos»");
  } else if (config.taxPolicy === "stripe_tax") {
    try {
      const settings = await stripe.tax.settings.retrieve();
      const registrations = (await stripe.tax.registrations.list({ status: "active", limit: 100 })).data;
      const spain = registrations.some((registration) => registration.country === "ES");
      (settings.status === "active" && spain ? ok : fail)("Stripe Tax", settings.status !== "active" ? `estado ${settings.status}`
        : spain ? `activo; registros: ${registrations.map((registration) => registration.country).join(", ")}` : "falta el registro de España");
    } catch (error) {
      fail("Stripe Tax", `${error.code || "sin permiso de lectura"} — compruébalo en el panel (Configuración → Impuestos)`);
    }
  }
}

main().catch((error) => fail("Error inesperado", error.code || error.name)).finally(() => {
  const mark = { ok: "✔", fail: "✘", warn: "!" };
  for (const row of results) console.log(`${mark[row.level]} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
  const failed = results.filter((row) => row.level === "fail").length;
  const warned = results.filter((row) => row.level === "warn").length;
  if (failed) console.log(`\n${failed} comprobación(es) fallida(s): NO actives TRAINER_BILLING_ENABLED.`);
  else console.log(warned ? `\nSin fallos. Revisa a mano los ${warned} aviso(s) (!) en el Dashboard antes de activar.`
    : "\nTodo correcto: puedes activar TRAINER_BILLING_ENABLED=1.");
  process.exitCode = failed ? 1 : 0;
});
