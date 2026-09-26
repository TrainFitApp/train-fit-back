const test = require("node:test");
const assert = require("node:assert/strict");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");
const { loadConfig } = require("../../.build/trainer-billing/config");

function fixture() {
  const config = loadConfig({ STRIPE_KEY: "rk_test_unit_test_placeholder",
    STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_pro_month", STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_pro_year",
    STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growth_month" });
  return { config, gateway: new StripeGateway(config) };
}
const quote = (extra = {}) => ({ quoteId: "quote-one", subscriptionId: "sub_owned", itemId: "si_owned",
  priceId: "price_pro_month", targetPriceId: "price_growth_month", prorationDate: 1800000000, periodEnd: 1801000000,
  from: { tier: "trainer_pro", interval: "monthly" }, to: { tier: "trainer_growth", interval: "monthly" }, ...extra });

test("immediate changes require payment before applying, replace the owned item, and retain retry parameters", async (t) => {
  const { gateway } = fixture();
  const calls = [];
  t.mock.method(gateway.stripe.subscriptions, "update", async (...args) => {
    calls.push(args); return { livemode: false, latest_invoice: "in_owned" };
  });
  const q = quote();
  await gateway.applyUpgrade(q, "operation-one");
  await gateway.applyUpgrade(q, "operation-one");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], "sub_owned");
  assert.deepEqual(calls[0][1].items, [{ id: "si_owned", price: "price_growth_month", quantity: 1 }]);
  assert.equal(calls[0][1].payment_behavior, "pending_if_incomplete");
  assert.equal(calls[0][1].proration_behavior, "always_invoice");
  assert.equal(calls[0][1].proration_date, 1800000000);
  assert.equal(calls[0][1].billing_cycle_anchor, undefined);
  await gateway.applyUpgrade(quote({ to: { tier: "trainer_pro", interval: "annual" } }), "annual-one");
  assert.equal(calls[2][1].billing_cycle_anchor, undefined);
  assert.equal(calls[2][1].proration_date, 1800000000);
});

test("annual-to-monthly preview schedules the current expiry and never simulates an immediate charge", async (t) => {
  const { gateway } = fixture();
  t.mock.method(gateway.stripe.invoices, "createPreview", async () => { throw new Error("Must not preview a charge today"); });
  const result = await gateway.previewChange({ id: "sub_owned", priceId: "price_pro_year", currentPeriodEnd: 1900000000 },
    { id: "price_pro_month", interval: "monthly", amount: 2900 }, "scheduled", 1800000000);
  assert.deepEqual(result, { amountDueNow: 0, renewalAmount: 2900, renewalAt: 1900000000, creditBalance: 0, renewalExcludesTax: false });
});

test("monthly-to-annual quote takes payable amount, new period and credit balance from Stripe", async (t) => {
  const { gateway } = fixture();
  let params;
  t.mock.method(gateway.stripe.invoices, "createPreview", async (request) => {
    params = request;
    return { livemode: false, currency: "eur", amount_due: 28200, ending_balance: -100,
      lines: { has_more: false, data: [{ amount: 29700, pricing: { price_details: { price: "price_pro_year" } }, period: { end: 1831536000 } }] } };
  });
  const result = await gateway.previewChange({ id: "sub_owned", itemId: "si_owned", priceId: "price_pro_month", currentPeriodEnd: 1801000000 },
    { id: "price_pro_year", interval: "annual", amount: 29700 }, "immediate", 1800000000);
  assert.equal(params.subscription_details.billing_cycle_anchor, undefined);
  assert.equal(params.subscription_details.proration_date, 1800000000);
  assert.equal(result.amountDueNow, 28200);
  assert.equal(result.renewalAt, 1831536000);
  assert.equal(result.creditBalance, 100);
});

function invoice() {
  return { id: "in_owned", livemode: false, status: "paid", customer: "cus_owned", currency: "eur",
    billing_reason: "subscription_update", parent: { subscription_details: { subscription: "sub_owned" } },
    hosted_invoice_url: "https://invoice.stripe.com/i/owned",
    lines: { has_more: false, data: [{ amount: 2000, period: { end: 1801000000 },
      pricing: { price_details: { price: "price_growth_month" } },
      parent: { type: "subscription_item_details", subscription_item_details: { subscription_item: "si_owned", proration: true } } }] } };
}
test("prorated access proof is scoped to the tracked change invoice, subscription, customer and debit item", async (t) => {
  const { gateway } = fixture();
  const inv = invoice();
  t.mock.method(gateway.stripe.invoices, "retrieve", async (invoiceId) => { assert.equal(invoiceId, "in_owned"); return inv; });
  const account = { customerId: "cus_owned" };
  const operation = { invoiceId: "in_owned", quote: quote() };
  assert.equal((await gateway.changePayment(account, operation)).paid, true);
  inv.status = "open";
  assert.equal((await gateway.changePayment(account, operation)).paid, false);
  inv.status = "paid";
  inv.lines.data[0].amount = -2000;
  assert.equal((await gateway.changePayment(account, operation)).paid, false);
  inv.lines.data[0].amount = 0; // A fully discounted invoice can be legitimately settled.
  assert.equal((await gateway.changePayment(account, operation)).paid, true);
  inv.lines.data[0].parent.subscription_item_details.subscription_item = "si_other";
  assert.equal((await gateway.changePayment(account, operation)).paid, false);
  inv.customer = "cus_other";
  await assert.rejects(gateway.changePayment(account, operation), { code: "PAYMENT_NOT_OWNED" });
  inv.customer = "cus_owned";
  inv.parent.subscription_details.subscription = "sub_other";
  await assert.rejects(gateway.changePayment(account, operation), { code: "PAYMENT_NOT_OWNED" });
});

test("scheduled change preserves existing discount identities, payment method and taxes; release keeps subscription", async (t) => {
  const { gateway } = fixture();
  const created = { id: "sub_sched", livemode: false, phases: [{ start_date: 1799000000, end_date: 1801000000,
    currency: "eur", collection_method: "charge_automatically", billing_cycle_anchor: "automatic", automatic_tax: { enabled: false },
    default_payment_method: "pm_saved", default_tax_rates: [{ id: "txr_existing" }],
    discounts: [{ discount: "di_existing", coupon: "coupon_old", promotion_code: null }],
    metadata: { scope: "trainers", trainfitUserId: "user-owned" }, add_invoice_items: [],
    items: [{ price: "price_pro_month", quantity: 1, discounts: [{ discount: "di_item", coupon: null, promotion_code: null }],
      tax_rates: [], metadata: { kept: "yes" } }] }] };
  const calls = [];
  t.mock.method(gateway.stripe.subscriptionSchedules, "create", async (params, opts) => {
    assert.deepEqual(params, { from_subscription: "sub_owned" });
    assert.equal(opts.idempotencyKey, "change-one-create"); return structuredClone(created);
  });
  t.mock.method(gateway.stripe.subscriptionSchedules, "update", async (...args) => { calls.push(args); return created; });
  await gateway.scheduleChange(quote(), "change-one");
  await gateway.scheduleChange(quote(), "change-one");
  assert.deepEqual(calls[0], calls[1]);
  const params = calls[0][1];
  assert.equal(params.end_behavior, "release");
  assert.equal(params.proration_behavior, "none");
  assert.equal(params.phases[1].start_date, 1801000000);
  assert.equal(params.phases[1].items[0].price, "price_growth_month");
  assert.deepEqual(params.phases[1].discounts, [{ discount: "di_existing" }]);
  assert.deepEqual(params.phases[1].items[0].discounts, [{ discount: "di_item" }]);
  assert.equal(params.phases[1].default_payment_method, "pm_saved");
  assert.deepEqual(params.phases[1].default_tax_rates, ["txr_existing"]);
  t.mock.method(gateway.stripe.subscriptionSchedules, "retrieve", async () => ({ livemode: false, status: "active" }));
  let released = false;
  t.mock.method(gateway.stripe.subscriptionSchedules, "release", async () => { released = true; });
  t.mock.method(gateway.stripe.subscriptionSchedules, "cancel", async () => { assert.fail("discard must never cancel subscription"); });
  await gateway.releaseSchedule("sub_sched", "release-one");
  assert.equal(released, true);
});

test("payment-action links cannot escape the hosted Stripe invoice origin", async (t) => {
  const { gateway } = fixture();
  const inv = invoice();
  t.mock.method(gateway.stripe.invoices, "retrieve", async () => inv);
  for (const value of ["https://evil.test/i/one", "http://invoice.stripe.com/i/one", "https://user@invoice.stripe.com/i/one"]) {
    inv.hosted_invoice_url = value;
    assert.equal((await gateway.changePayment({ customerId: "cus_owned" }, { invoiceId: "in_owned", quote: quote() })).url, undefined);
  }
});

test("sandbox test clocks use expanded simulated time and normal subscriptions need no extra clock request", async (t) => {
  const { gateway } = fixture();
  const sub = { id: "sub_owned", customer: "cus_owned", livemode: false, status: "active", cancel_at_period_end: false,
    metadata: { scope: "trainers", trainfitUserId: "user-owned" }, latest_invoice: null,
    items: { has_more: false, data: [{ id: "si_owned", price: { id: "price_pro_month" }, quantity: 1,
      current_period_start: 1800000000, current_period_end: 1802592000 }] } };
  t.mock.method(gateway.stripe.subscriptions, "list", async (params) => {
    assert.ok(params.expand.includes("data.test_clock"));
    return { has_more: false, data: [sub] };
  });
  t.mock.method(gateway.stripe.testHelpers.testClocks, "retrieve", async () => assert.fail("no separate permission or clock request"));
  assert.equal((await gateway.listSubscriptions("cus_owned"))[0].billingNow, undefined);
  sub.test_clock = { id: "clock_test", frozen_time: 1800001000, status: "ready", livemode: false };
  assert.equal((await gateway.listSubscriptions("cus_owned"))[0].billingNow, 1800001000);
  sub.test_clock.status = "advancing";
  await assert.rejects(gateway.listSubscriptions("cus_owned"), { code: "TEST_CLOCK_NOT_READY" });
});
