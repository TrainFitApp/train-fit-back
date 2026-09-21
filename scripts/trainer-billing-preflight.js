#!/usr/bin/env node
// Chequeo previo de la facturación de Trainers, para ejecutar en el servidor
// ANTES de poner TRAINER_BILLING_ENABLED=1: `npm run billing:preflight`.
// Lee la configuración del entorno, comprueba contra Stripe el catálogo, el
// portal y la política fiscal, y no imprime nunca claves ni secretos. No
// modifica nada ni en Stripe ni en la base de datos.
const fs = require("fs");
const path = require("path");

const buildDir = path.join(__dirname, "../.build/trainer-billing");
const results = [];
const ok = (name, detail = "") => results.push({ ok: true, name, detail });
const fail = (name, detail = "") => results.push({ ok: false, name, detail });

async function main() {
  if (!fs.existsSync(path.join(buildDir, "runtime.js"))) {
    fail("Módulo compilado", "Falta .build/trainer-billing: ejecuta `npm run build:trainer-billing`.");
    return;
  }
  ok("Módulo compilado");
  // Mismo cargador que el servidor: .env si existe, sin sobrescribir el entorno.
  try { require("dotenv").config(); } catch { /* entorno ya cargado por PM2 */ }
  const { loadConfig } = require(path.join(buildDir, "config"));
  const { StripeGateway } = require(path.join(buildDir, "stripe-gateway"));
  const config = loadConfig({ ...process.env, TRAINER_BILLING_ENABLED: "1" });
  ok("Modo", config.mode);
  ok("Política fiscal", config.taxPolicy);
  if (config.errors.length) {
    fail("Configuración", config.errors.join(", "));
    return;
  }
  ok("Configuración", "sin errores");
  const gateway = new StripeGateway(config);
  for (const plan of config.plans) {
    for (const price of Object.values(plan.prices)) {
      try {
        await gateway.validatePrice(price);
        ok(`Precio ${plan.tier} ${price.interval}`, `${(price.amount / 100).toFixed(2)} € ${config.taxPolicy === "stripe_tax" ? "+ IVA" : ""}`);
      } catch (error) {
        fail(`Precio ${plan.tier} ${price.interval}`, error.code || "no coincide con el catálogo (importe, intervalo, modo o IVA)");
      }
    }
  }
  try {
    const configuration = await gateway.stripe.billingPortal.configurations.retrieve(config.portalConfiguration);
    const features = configuration.features;
    const valid = configuration.active && configuration.livemode === (config.mode === "live") && !features.subscription_update?.enabled &&
      features.invoice_history?.enabled && features.payment_method_update?.enabled &&
      features.subscription_cancel?.enabled && features.subscription_cancel.mode === "at_period_end";
    (valid ? ok : fail)("Portal de clientes", valid ? "facturas, tarjeta y cancelación a fin de periodo; sin cambios de plan"
      : "debe tener facturas, método de pago y cancelación a fin de periodo, y cambios de plan DESACTIVADOS");
  } catch (error) {
    fail("Portal de clientes", error.code || "no se pudo leer la configuración del portal");
  }
  if (config.taxPolicy === "stripe_tax") {
    try {
      const settings = await gateway.stripe.tax.settings.retrieve();
      (settings.status === "active" ? ok : fail)("Stripe Tax", settings.status === "active" ? "activo" : `estado ${settings.status}`);
    } catch (error) {
      fail("Stripe Tax", `${error.code || "sin permiso de lectura"} — compruébalo en el panel (Configuración → Impuestos)`);
    }
  }
}

main().catch((error) => fail("Error inesperado", error.code || error.name)).finally(() => {
  for (const row of results) console.log(`${row.ok ? "✔" : "✘"} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
  const failed = results.filter((row) => !row.ok).length;
  console.log(failed ? `\n${failed} comprobación(es) fallida(s): NO actives TRAINER_BILLING_ENABLED.` : "\nTodo correcto: puedes activar TRAINER_BILLING_ENABLED=1.");
  process.exitCode = failed ? 1 : 0;
});
