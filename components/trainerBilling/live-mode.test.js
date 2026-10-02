const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");

// Modo live y Stripe Tax sin red: firma, aislamiento de entornos e IVA.
const prices = {
  STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_promonthly", STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_proannual",
  STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growthmonthly", STRIPE_TRAINER_GROWTH_ANNUAL_PRICE_ID: "price_growthannual",
  STRIPE_TRAINER_SCALE_MONTHLY_PRICE_ID: "price_scalemonthly", STRIPE_TRAINER_SCALE_ANNUAL_PRICE_ID: "price_scaleannual",
};
function gateway(mode, overrides = {}) {
  const config = loadConfig({ ...prices, TRAINER_BILLING_ENABLED: "1", TRAINER_BILLING_MODE: mode,
    STRIPE_KEY: [mode === "live" ? "rk_live" : "rk_test", "fakeForUnitTests"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "fakeForUnitTests"].join("_"), STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit",
    TRAINER_BILLING_TAX_POLICY: "stripe_tax", STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_unit",
    TRAINER_BILLING_TERMS_URL: "https://trainfit.example.test/condiciones", TRAINER_BILLING_SUPPORT_EMAIL: "facturacion@example.test",
    TRAINER_BILLING_FRONTEND_URL: mode === "live" ? "https://trainers.example.test" : "http://localhost:8100", ...overrides });
  assert.deepEqual(config.errors, []);
  return { config, gateway: new StripeGateway(config) };
}
function signed(g, config, event) {
  const payload = JSON.stringify(event);
  return [Buffer.from(payload), g.stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret })];
}

test("each mode only accepts events and objects of its own environment", () => {
  const live = gateway("live");
  const test = gateway("test");
  const event = (livemode) => ({ id: "evt_x", type: "invoice.paid", livemode, data: { object: { customer: "cus_1" } } });
  assert.equal(live.gateway.verifyEvent(...signed(live.gateway, live.config, event(true))).mode, "live");
  assert.throws(() => live.gateway.verifyEvent(...signed(live.gateway, live.config, event(false))), { code: "MODE_MISMATCH" });
  assert.equal(test.gateway.verifyEvent(...signed(test.gateway, test.config, event(false))).mode, "test");
  assert.throws(() => test.gateway.verifyEvent(...signed(test.gateway, test.config, event(true))), { code: "MODE_MISMATCH" });
});

test("refund and dispute events keep only the identifiers needed to act, never card data", () => {
  const { gateway: g, config } = gateway("live");
  const refund = g.verifyEvent(...signed(g, config, { id: "evt_r", type: "charge.refunded", livemode: true,
    data: { object: { id: "ch_1", customer: "cus_1", payment_intent: "pi_1", refunded: true,
      payment_method_details: { card: { last4: "4242" } }, billing_details: { email: "x@example.test" } } } }));
  assert.deepEqual(refund.detail, { chargeId: "ch_1", paymentIntentId: "pi_1", fullyRefunded: true });
  assert.equal(refund.customerId, "cus_1");
  assert.ok(!JSON.stringify(refund).includes("4242"));
  const partial = g.verifyEvent(...signed(g, config, { id: "evt_p", type: "charge.refunded", livemode: true,
    data: { object: { id: "ch_2", customer: "cus_1", payment_intent: "pi_2", refunded: false } } }));
  assert.equal(partial.detail.fullyRefunded, false);
  const dispute = g.verifyEvent(...signed(g, config, { id: "evt_d", type: "charge.dispute.created", livemode: true,
    data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1" } } }));
  assert.equal(dispute.customerId, null, "a Dispute has no customer; the service resolves it");
  assert.deepEqual(dispute.detail, { disputeId: "dp_1", chargeId: "ch_1", paymentIntentId: "pi_1" });
});

test("with Stripe Tax, Checkout collects address and tax ID, and prices must exclude VAT", async (t) => {
  const { gateway: g } = gateway("live");
  let params;
  t.mock.method(g.stripe.checkout.sessions, "create", async (p) => { params = p;
    return { id: "cs_live_1", customer: "cus_1", subscription: null, status: "open", url: "https://checkout.stripe.com/c/pay/x",
      livemode: true, metadata: p.metadata }; });
  await g.createCheckout({ id: "u1", email: "t@example.test" }, { customerId: "cus_1", checkout: { startedAt: new Date() } },
    { id: "price_promonthly", amount: 2900, interval: "monthly" }, "trainers-checkout-ab12cd34");
  assert.equal(params.automatic_tax.enabled, true);
  assert.equal(params.billing_address_collection, "required");
  assert.equal(params.tax_id_collection.enabled, true);
  assert.deepEqual(params.customer_update, { address: "auto", name: "auto" });
  assert.ok(params.success_url.startsWith("https://trainers.example.test/"));
  // Decisiones 2026-09-28: métodos aprobados, condiciones aceptadas y aviso de renovación junto al pago.
  assert.equal(params.payment_method_configuration, "pmc_unit");
  assert.deepEqual(params.consent_collection, { terms_of_service: "required" });
  assert.match(params.custom_text.submit.message, /se renueva automáticamente cada mes/);
  assert.match(params.custom_text.submit.message, /facturacion@example\.test/);
  assert.match(params.custom_text.terms_of_service_acceptance.message, /\(https:\/\/trainfit\.example\.test\/condiciones\)/);

  const price = (tax_behavior) => ({ livemode: true, active: true, type: "recurring", currency: "eur", unit_amount: 2900,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, tax_behavior });
  t.mock.method(g.stripe.prices, "retrieve", async () => price("inclusive"));
  await assert.rejects(g.validatePrice({ id: "price_promonthly", amount: 2900, interval: "monthly" }), { code: "PRICE_MISMATCH" });
  g.stripe.prices.retrieve.mock.mockImplementation(async () => price("exclusive"));
  await g.validatePrice({ id: "price_promonthly", amount: 2900, interval: "monthly" });
});

test("with Managed Payments, Stripe sells: Checkout enables it and drops what Stripe controls", async (t) => {
  const { gateway: g } = gateway("live", { TRAINER_BILLING_TAX_POLICY: "managed_payments" });
  let params;
  t.mock.method(g.stripe.checkout.sessions, "create", async (p) => { params = p;
    return { id: "cs_live_2", customer: "cus_1", subscription: null, status: "open", url: "https://checkout.stripe.com/c/pay/y",
      livemode: true, metadata: p.metadata }; });
  await g.createCheckout({ id: "u1", email: "t@example.test" }, { customerId: "cus_1", checkout: { startedAt: new Date() } },
    { id: "price_promonthly", amount: 2900, interval: "monthly" }, "trainers-checkout-ab12cd34");
  assert.deepEqual(params.managed_payments, { enabled: true });
  assert.equal(params.billing_address_collection, "required");
  // Comprobado en el sandbox (2026-10-01): Stripe calcula el impuesto, elige los métodos y rechaza custom_text.
  for (const key of ["automatic_tax", "tax_id_collection", "customer_update", "payment_method_configuration", "custom_text"]) {
    assert.equal(key in params, false, `${key} lo controla Stripe con Managed Payments`);
  }
  assert.deepEqual(params.consent_collection, { terms_of_service: "required" }, "las condiciones se siguen aceptando al pagar");

  // Los precios siguen siendo sin IVA: Stripe lo añade como vendedor.
  t.mock.method(g.stripe.prices, "retrieve", async () => ({ livemode: true, active: true, type: "recurring", currency: "eur",
    unit_amount: 2900, recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, tax_behavior: "inclusive" }));
  await assert.rejects(g.validatePrice({ id: "price_promonthly", amount: 2900, interval: "monthly" }), { code: "PRICE_MISMATCH" });
});

test("a change quote reports the VAT that Stripe adds to the amount due now", async (t) => {
  const { gateway: g, config } = gateway("live");
  const line = (price, amount, proration) => ({ amount, pricing: { price_details: { price } }, period: { start: 1, end: 2 },
    parent: { type: "subscription_item_details", subscription_item_details: { proration, subscription_item: "si_1" } } });
  t.mock.method(g.stripe.invoices, "createPreview", async (p) => {
    assert.deepEqual(p.automatic_tax, { enabled: true });
    return { livemode: true, currency: "eur", amount_due: 2420, ending_balance: 0, total_taxes: [{ amount: 420 }],
      lines: { has_more: false, data: [line("price_promonthly", -2900, true), line("price_growthmonthly", 4900, true)] } };
  });
  const preview = await g.previewChange({ id: "sub_1", itemId: "si_1", priceId: "price_promonthly", currentPeriodEnd: 2 },
    config.plans.find((plan) => plan.tier === "trainer_growth").prices.monthly, "immediate", 1);
  assert.equal(preview.amountDueNow, 2420);
  assert.equal(preview.taxAmount, 420);
  assert.equal(preview.renewalExcludesTax, false);
});
