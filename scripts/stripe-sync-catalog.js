#!/usr/bin/env node
// Crea o pone al día en Stripe el catálogo de Trainers (productos y precios) a partir de
// components/trainerBilling/src/catalog.ts. Una vez por entorno (sandbox y real) y cada vez que
// cambie un precio del catálogo:
//
//   npm run stripe:catalog:dry-run   enseña lo que haría, sin tocar nada
//   npm run stripe:catalog           lo aplica
//
// Usa la cuenta de STRIPE_KEY (el prefijo decide sandbox o real). La clave restringida del
// servidor no suele poder escribir productos ni precios: en ese caso se ejecuta con
// STRIPE_CATALOG_KEY (una clave con ese permiso, puesta en el .env o en la línea de comandos,
// nunca en el chat). No imprime claves.
//
// Cada precio lleva su lookup key (la busca el backend) y metadatos trainfit_* (con ellos se
// reconoce aunque se archive). Un precio que no cuadra con el catálogo no se modifica: se crea
// uno nuevo que hereda la lookup key y el antiguo se archiva; las suscripciones que lo tengan
// siguen funcionando hasta que cambien de plan.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const Stripe = require("stripe");

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[stripe-catalog]";
const log = (...a) => console.log(LOG, ...a);
// SaaS - Business Use: código admitido por Managed Payments (docs.stripe.com/tax/digital-products).
const TAX_CODE = "txcd_10103001";
const NAMES = { starter: "Inicio", professional: "Profesional", scale: "Escala", free: "Free" };
const INTERVAL_NAMES = { monthly: "mensual", annual: "anual" };

async function main() {
  const catalog = require("../.build/trainer-billing/catalog");
  const { API_VERSION } = require("../.build/trainer-billing/config");
  const key = (process.env.STRIPE_CATALOG_KEY || process.env.STRIPE_KEY || "").trim();
  const mode = /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : null;
  if (!mode) throw new Error("Falta STRIPE_KEY (o STRIPE_CATALOG_KEY) de Stripe.");
  log(`cuenta ${mode === "live" ? "REAL" : "sandbox"}  dryRun=${DRY_RUN}`);
  const stripe = new Stripe(key, { apiVersion: API_VERSION, maxNetworkRetries: 2 });

  // Productos: uno por plan de pago y uno para las plazas adicionales (también las de Free).
  const wantedProducts = [
    ...catalog.TIERS.filter((tier) => tier !== "free").map((tier) => ({ id: `plan_${tier}`, name: `TrainFit Trainers ${NAMES[tier]}` })),
    { id: "seat", name: "TrainFit Trainers · Plaza adicional de cliente" },
  ];
  const existing = new Map();
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.trainfit_catalog === "trainers" && product.metadata.trainfit_product) {
      existing.set(product.metadata.trainfit_product, product);
    }
  }
  const productIds = new Map();
  for (const wanted of wantedProducts) {
    const product = existing.get(wanted.id);
    if (product) {
      productIds.set(wanted.id, product.id);
      log(`= producto ${wanted.name}`);
      if (product.tax_code && (typeof product.tax_code === "string" ? product.tax_code : product.tax_code.id) !== TAX_CODE) {
        log(`  ! su código fiscal no es ${TAX_CODE}: revísalo en el Dashboard (Managed Payments exige uno admitido)`);
      }
      continue;
    }
    log(`+ producto ${wanted.name}`);
    if (DRY_RUN) { productIds.set(wanted.id, `(nuevo ${wanted.id})`); continue; }
    const created = await stripe.products.create({ name: wanted.name, tax_code: TAX_CODE,
      metadata: { trainfit_catalog: "trainers", trainfit_product: wanted.id } });
    productIds.set(wanted.id, created.id);
  }

  const entries = catalog.catalogPrices();
  const lookupKeys = entries.map((entry) => catalog.lookupKey(entry.kind, entry.tier, entry.interval));
  const current = new Map();
  for (const price of (await stripe.prices.list({ lookup_keys: lookupKeys, active: true, limit: 100 })).data) {
    current.set(price.lookup_key, price);
  }
  let changes = 0;
  for (const entry of entries) {
    const lookupKey = catalog.lookupKey(entry.kind, entry.tier, entry.interval);
    const productKey = entry.kind === "base" ? `plan_${entry.tier}` : "seat";
    const product = productIds.get(productKey);
    const price = current.get(lookupKey);
    const label = entry.kind === "base" ? `${NAMES[entry.tier]} ${INTERVAL_NAMES[entry.interval]}`
      : `plaza adicional ${NAMES[entry.tier]} ${INTERVAL_NAMES[entry.interval]}`;
    const amount = `${(entry.amount / 100).toFixed(2)} € + IVA`;
    const productId = price && (typeof price.product === "string" ? price.product : price.product.id);
    const ok = price && price.unit_amount === entry.amount && price.currency === "eur" && price.tax_behavior === "exclusive" &&
      price.recurring?.interval === (entry.interval === "annual" ? "year" : "month") && price.recurring.interval_count === 1 &&
      price.recurring.usage_type === "licensed" && price.billing_scheme === "per_unit" && productId === product &&
      price.metadata?.trainfit_catalog === "trainers" && price.metadata.trainfit_kind === entry.kind &&
      price.metadata.trainfit_tier === entry.tier && price.metadata.trainfit_interval === entry.interval;
    if (ok) { log(`= precio ${label} (${amount})`); continue; }
    changes += 1;
    log(`${price ? "~ sustituir" : "+ crear"} precio ${label} (${amount})`);
    if (DRY_RUN) continue;
    await stripe.prices.create({ product, currency: "eur", unit_amount: entry.amount, tax_behavior: "exclusive",
      recurring: { interval: entry.interval === "annual" ? "year" : "month", interval_count: 1, usage_type: "licensed" },
      lookup_key: lookupKey, transfer_lookup_key: true, nickname: label,
      metadata: { trainfit_catalog: "trainers", trainfit_kind: entry.kind, trainfit_tier: entry.tier, trainfit_interval: entry.interval } });
    if (price) await stripe.prices.update(price.id, { active: false });
  }
  log(changes ? `${changes} precio(s) ${DRY_RUN ? "por crear o sustituir (dry-run, sin cambios)" : "creados o sustituidos"}` : "catálogo al día");
  log("Los productos y precios del catálogo anterior (Pro, Growth, Scale) se archivan a mano en el Dashboard.");
}

main().catch((error) => {
  console.error(LOG, error.code || error.type || "", error.message);
  process.exit(1);
});
