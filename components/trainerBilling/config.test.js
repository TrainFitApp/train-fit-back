const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig, parseTarget, publicPlans, requireReady, stateView } = require("../../.build/trainer-billing/config");
const { errorCode, fake, sandboxEnv, state } = require("./test-support");

const liveEnv = (overrides = {}) => sandboxEnv({ STRIPE_KEY: fake("rk", "live", "unit"), STRIPE_RETURN_URL: "https://trainers.trainfit.net",
  STRIPE_TERMS_URL: "https://trainfit.net/condiciones", STRIPE_SUPPORT_EMAIL: "facturacion@trainfit.net", ...overrides });

test("sin STRIPE_KEY la facturación está apagada, sin errores de configuración", () => {
  const config = loadConfig({});
  assert.equal(config.enabled, false);
  assert.deepEqual(config.errors, []);
  assert.throws(() => requireReady(config), errorCode("BILLING_DISABLED"));
  const plans = publicPlans(config);
  assert.equal(plans.enabled, false);
  assert.deepEqual(plans.capabilities, { checkout: false, portal: false, planChanges: false });
});

test("el sandbox basta con la clave de prueba y el secreto del webhook", () => {
  const config = loadConfig(sandboxEnv());
  assert.equal(config.mode, "test");
  assert.deepEqual(config.errors, []);
  assert.doesNotThrow(() => requireReady(config));
  // PRE sirve la web por https fuera de localhost con claves de prueba.
  assert.deepEqual(loadConfig(sandboxEnv({ STRIPE_RETURN_URL: "https://trainers-pre.trainfit.net/" })).errors, []);
  assert.equal(loadConfig(sandboxEnv({ STRIPE_RETURN_URL: "https://trainers-pre.trainfit.net/" })).returnUrl, "https://trainers-pre.trainfit.net");
});

test("la configuración falla cerrada: clave desconocida, secreto o URL de vuelta inválidos", () => {
  assert.ok(loadConfig(sandboxEnv({ STRIPE_KEY: fake("sk", "live", "unit") })).errors.includes("INVALID_STRIPE_KEY"),
    "en real no se admite una clave secreta completa");
  assert.ok(loadConfig(sandboxEnv({ STRIPE_WEBHOOK_SECRET: "" })).errors.includes("WEBHOOK_SECRET_REQUIRED"));
  for (const url of ["https://trainers.example/app", "https://user:pass@trainers.example", "ftp://trainers.example", "nope"]) {
    assert.ok(loadConfig(sandboxEnv({ STRIPE_RETURN_URL: url })).errors.includes("INVALID_RETURN_URL"), url);
  }
  assert.ok(loadConfig(sandboxEnv({ STRIPE_TERMS_URL: "javascript:alert(1)" })).errors.includes("INVALID_TERMS_URL"));
  assert.ok(loadConfig(sandboxEnv({ STRIPE_SUPPORT_EMAIL: "no-es-un-email" })).errors.includes("INVALID_SUPPORT_EMAIL"));
  assert.throws(() => requireReady(loadConfig(sandboxEnv({ STRIPE_WEBHOOK_SECRET: "" }))), errorCode("BILLING_NOT_READY"));
});

test("en real exige web https pública, condiciones y buzón de facturación", () => {
  assert.deepEqual(loadConfig(liveEnv()).errors, []);
  assert.equal(loadConfig(liveEnv()).mode, "live");
  assert.ok(loadConfig(liveEnv({ STRIPE_RETURN_URL: "http://localhost:8100" })).errors.includes("HTTPS_RETURN_URL_REQUIRED"));
  assert.ok(loadConfig(liveEnv({ STRIPE_TERMS_URL: "" })).errors.includes("TERMS_URL_REQUIRED"));
  assert.ok(loadConfig(liveEnv({ STRIPE_SUPPORT_EMAIL: "" })).errors.includes("SUPPORT_EMAIL_REQUIRED"));
  assert.ok(loadConfig(liveEnv({ STRIPE_TERMS_URL: "http://localhost/terms" })).errors.includes("INVALID_TERMS_URL"),
    "un enlace local solo vale en el sandbox");
});

test("el navegador solo elige plan, periodicidad y plazas, nunca importes ni precios", () => {
  assert.deepEqual(parseTarget({ tier: "starter", interval: "annual", extraSeats: 5 }), state("starter", "annual", 5));
  assert.deepEqual(parseTarget({ tier: "professional", interval: "monthly" }), state("professional", "monthly", 0));
  assert.deepEqual(parseTarget({ tier: "free", interval: "monthly", extraSeats: 2, amount: 1, priceId: "price_evil" }),
    state("free", "monthly", 2), "los campos ajenos se ignoran");
  for (const bad of [null, "starter", {}, { tier: "free", interval: "monthly" }, { tier: "starter", interval: "monthly", extraSeats: "5" },
    { tier: "starter", interval: "monthly", extraSeats: 21 }, { tier: "scale", interval: "annual", extraSeats: 1 },
    { tier: "__proto__", interval: "monthly" }]) {
    assert.throws(() => parseTarget(bad), errorCode("INVALID_PLAN"), JSON.stringify(bad));
  }
});

test("el catálogo público sale del código: plazas, cuotas y precio de plaza por periodicidad", () => {
  const plans = publicPlans(loadConfig(sandboxEnv({ STRIPE_SUPPORT_EMAIL: "facturacion@trainfit.net" })));
  assert.equal(plans.enabled, true);
  assert.equal(plans.freeSeats, 3);
  assert.deepEqual(plans.support, { email: "facturacion@trainfit.net", termsUrl: null });
  const byTier = Object.fromEntries(plans.plans.map((plan) => [plan.tier, plan]));
  assert.deepEqual(Object.keys(byTier), ["free", "starter", "professional", "scale"]);
  assert.deepEqual(byTier.free, { tier: "free", includedSeats: 3, maxSeats: 12, prices: { monthly: { base: 0, seat: 300 } } });
  assert.deepEqual(byTier.starter.prices, { monthly: { base: 2900, seat: 100 }, annual: { base: 29000, seat: 1000 } });
  assert.deepEqual(byTier.scale.prices.annual, { base: 109000, seat: null });
  assert.equal(byTier.professional.maxSeats, 125);
  assert.deepEqual(stateView(state("professional", "monthly", 25)), { tier: "professional", interval: "monthly", extraSeats: 25,
    seats: 75, amount: 6900 });
});
