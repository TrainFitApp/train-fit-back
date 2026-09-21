const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");

function fixture() {
  const config = loadConfig({ STRIPE_KEY: ["rk", "test", "fakeForUnitTests"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "fakeForUnitTests"].join("_"),
    STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit", TRAINER_BILLING_TAX_POLICY: "test_no_tax" });
  return { config, gateway: new StripeGateway(config) };
}

test("gateway verifies signed raw bytes, rejects tampering and live events", () => {
  const { gateway, config } = fixture();
  const payload = JSON.stringify({ id: "evt_unit", type: "invoice.paid", livemode: false, data: { object: { customer: "cus_unit" } } });
  const signature = gateway.stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
  assert.equal(gateway.verifyEvent(Buffer.from(payload), signature).customerId, "cus_unit");
  assert.throws(() => gateway.verifyEvent(Buffer.from(payload + " "), signature), { code: "INVALID_SIGNATURE" });
  assert.throws(() => gateway.verifyEvent(Buffer.from(payload), "wrong"), { code: "INVALID_SIGNATURE" });
  const live = payload.replace('"livemode":false', '"livemode":true');
  const liveSignature = gateway.stripe.webhooks.generateTestHeaderString({ payload: live, secret: config.webhookSecret });
  assert.throws(() => gateway.verifyEvent(Buffer.from(live), liveSignature), { code: "MODE_MISMATCH" });
});

test("hosted Checkout has stable idempotent parameters and an expiration margin above 30 minutes", async (t) => {
  const { gateway } = fixture();
  const requests = [];
  t.mock.method(gateway.stripe.checkout.sessions, "create", async (params, options) => {
    requests.push({ params, options });
    return { id: "cs_test_unit", customer: "cus_unit", subscription: null, status: "open",
      url: "https://checkout.stripe.com/c/pay/unit", livemode: false, metadata: params.metadata };
  });
  const user = { id: "user1", email: "trainer@example.test" };
  const account = { customerId: "cus_unit", checkout: { startedAt: new Date(Date.now() - 5000) } };
  const price = { id: "price_unit", amount: 2900, interval: "monthly" };
  const key = "trainers-checkout-ab12cd34";
  await gateway.createCheckout(user, account, price, key);
  await gateway.createCheckout(user, account, price, key);
  assert.deepEqual(requests[0], requests[1]);
  const { params, options } = requests[0];
  assert.equal(options.idempotencyKey, key);
  assert.equal(params.mode, "subscription");
  assert.equal(params.automatic_tax.enabled, false);
  assert.equal(params.payment_method_types, undefined);
  assert.equal(params.line_items[0].price, "price_unit");
  assert.match(params.integration_identifier, /^trainfit_trainers_[a-z]{8}$/);
  assert.ok(params.expires_at > Math.floor(Date.now() / 1000) + 1800);
  assert.equal(params.success_url, "http://localhost:8100/tabs/subscription?session_id={CHECKOUT_SESSION_ID}");
});

test("configured price must match test mode, amount, currency and recurrence", async (t) => {
  const { gateway } = fixture();
  const price = { id: "price_unit", amount: 2900, interval: "monthly" };
  const valid = { active: true, livemode: false, type: "recurring", currency: "eur", unit_amount: 2900,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
  for (const change of [{ currency: "usd" }, { unit_amount: 290 }, { active: false },
    { recurring: { ...valid.recurring, interval_count: 3 } }, { livemode: true }]) {
    const mock = t.mock.method(gateway.stripe.prices, "retrieve", async () => ({ ...valid, ...change }));
    await assert.rejects(gateway.validatePrice(price));
    mock.mock.restore();
  }
  t.mock.method(gateway.stripe.prices, "retrieve", async () => valid);
  await gateway.validatePrice(price);
});

test("portal cannot enable unpaid upgrades or immediate cancellation", async (t) => {
  const { gateway } = fixture();
  const configuration = { id: "bpc_unit", active: true, livemode: false, features: {
    invoice_history: { enabled: true }, payment_method_update: { enabled: true },
    subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: "at_period_end" },
  } };
  t.mock.method(gateway.stripe.billingPortal.configurations, "retrieve", async () => configuration);
  let created = 0;
  t.mock.method(gateway.stripe.billingPortal.sessions, "create", async (params) => {
    created++;
    assert.equal(params.customer, "cus_unit");
    assert.equal(params.configuration, "bpc_unit");
    return { url: "https://billing.stripe.com/p/session/unit" };
  });
  configuration.features.subscription_update.enabled = true;
  await assert.rejects(gateway.createPortal("cus_unit"), { code: "PORTAL_NOT_READY" });
  configuration.features.subscription_update.enabled = false;
  configuration.features.subscription_cancel.mode = "immediately";
  await assert.rejects(gateway.createPortal("cus_unit"), { code: "PORTAL_NOT_READY" });
  assert.equal(created, 0);
  configuration.features.subscription_cancel.mode = "at_period_end";
  assert.equal(await gateway.createPortal("cus_unit"), "https://billing.stripe.com/p/session/unit");
});

test("paid invoice must contain a non-prorated matching subscription item", async (t) => {
  const { gateway } = fixture();
  const line = { pricing: { price_details: { price: { id: "price_unit" } } }, period: { end: 2000000000 },
    parent: { type: "subscription_item_details", subscription_item_details: { subscription_item: "si_unit", proration: false } } };
  t.mock.method(gateway.stripe.subscriptions, "list", async () => ({ has_more: false, data: [{
    id: "sub_unit", customer: "cus_unit", livemode: false, status: "active", cancel_at_period_end: false,
    metadata: { scope: "trainers", trainfitUserId: "user1" },
    items: { has_more: false, data: [{ id: "si_unit", price: { id: "price_unit" }, quantity: 1, current_period_end: 2000000000 }] },
    latest_invoice: { id: "in_unit", livemode: false, status: "paid", lines: { has_more: false, data: [line] } },
  }] }));
  assert.equal((await gateway.listSubscriptions("cus_unit"))[0].paidPriceId, "price_unit");
  line.parent.subscription_item_details.proration = true;
  assert.equal((await gateway.listSubscriptions("cus_unit"))[0].paidPriceId, null);
  line.parent.subscription_item_details.proration = false;
  line.parent.subscription_item_details.subscription_item = "si_other";
  assert.equal((await gateway.listSubscriptions("cus_unit"))[0].paidPriceId, null);
});
