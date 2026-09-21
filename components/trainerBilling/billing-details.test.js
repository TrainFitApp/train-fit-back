const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");
const { TrainerBillingService } = require("../../.build/trainer-billing/service");

// Facturas, método de pago y desglose del prorrateo: todo sale de Stripe; aquí
// solo se comprueba el filtrado de seguridad y el etiquetado, sin red.
function fixture() {
  const config = loadConfig({ NODE_ENV: "test", TRAINER_BILLING_ENABLED: "1",
    STRIPE_KEY: ["rk", "test", "fakeForUnitTests"].join("_"), STRIPE_WEBHOOK_SECRET: ["whsec", "fakeForUnitTests"].join("_"),
    STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit", TRAINER_BILLING_TAX_POLICY: "test_no_tax",
    STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_promonthly", STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_proannual",
    STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growthmonthly", STRIPE_TRAINER_GROWTH_ANNUAL_PRICE_ID: "price_growthannual",
    STRIPE_TRAINER_SCALE_MONTHLY_PRICE_ID: "price_scalemonthly", STRIPE_TRAINER_SCALE_ANNUAL_PRICE_ID: "price_scaleannual" });
  return { config, gateway: new StripeGateway(config) };
}
const line = (price, amount, proration, start = 1000, end = 2000) => ({ amount,
  pricing: { price_details: { price } }, period: { start, end },
  parent: { type: "subscription_item_details", subscription_item_details: { proration, subscription_item: "si_1" } } });

test("invoice history keeps only this customer's finalized invoices and Stripe-hosted links", async (t) => {
  const { gateway } = fixture();
  const base = { livemode: false, customer: "cus_me", currency: "eur", total: 2900, amount_paid: 2900, amount_due: 0,
    created: 1790000000, lines: { data: [line("price_promonthly", 2900, false)] } };
  t.mock.method(gateway.stripe.invoices, "list", async (params) => {
    assert.equal(params.customer, "cus_me");
    return { data: [
      { ...base, id: "in_paid", number: "TF-0001", status: "paid", billing_reason: "subscription_cycle",
        hosted_invoice_url: "https://invoice.stripe.com/i/acct/in_paid", invoice_pdf: "https://pay.stripe.com/invoice/acct/pdf" },
      { ...base, id: "in_draft", status: "draft", billing_reason: "subscription_cycle" },
      { ...base, id: "in_other", customer: "cus_someone_else", status: "paid" },
      { ...base, id: "in_evil", status: "open", billing_reason: "manual",
        hosted_invoice_url: "https://invoice.stripe.com.evil.example/i/x", invoice_pdf: "http://pay.stripe.com/insecure" },
    ] };
  });
  t.mock.method(gateway.stripe.subscriptions, "retrieve", async () => ({ livemode: false, customer: "cus_me",
    default_payment_method: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 9, exp_year: 2027 } } }));
  const details = await gateway.billingDetails("cus_me", "sub_me");
  assert.deepEqual(details.invoices.map((invoice) => invoice.id), ["in_paid", "in_evil"]);
  assert.equal(details.invoices[0].reason, "subscription_cycle");
  assert.equal(details.invoices[0].pdfUrl, "https://pay.stripe.com/invoice/acct/pdf");
  assert.equal(details.invoices[1].reason, "other");
  assert.equal(details.invoices[1].hostedUrl, undefined, "a lookalike host is never linked");
  assert.equal(details.invoices[1].pdfUrl, undefined, "a non-https PDF is never linked");
  assert.deepEqual(details.paymentMethod, { brand: "visa", last4: "4242", expMonth: 9, expYear: 2027 });
});

test("the payment method is optional: a permission error hides it instead of failing the page", async (t) => {
  const { gateway } = fixture();
  t.mock.method(gateway.stripe.invoices, "list", async () => ({ data: [] }));
  t.mock.method(gateway.stripe.subscriptions, "retrieve", async () => { throw Object.assign(new Error("perm"), { code: "more_permissions_required" }); });
  assert.deepEqual(await gateway.billingDetails("cus_me", "sub_me"), { invoices: [], paymentMethod: null });
});

test("an immediate change quote itemises Stripe's credit and charge lines by plan", async (t) => {
  const { gateway, config } = fixture();
  t.mock.method(gateway.stripe.invoices, "createPreview", async (params) => ({ livemode: false, currency: "eur",
    amount_due: 2000, ending_balance: 0, lines: { has_more: false, data: params.subscription_details.proration_behavior === "none"
      ? [line("price_growthmonthly", 4900, false)]
      : [line("price_promonthly", -2900, true), line("price_growthmonthly", 4900, true), line("price_unknown", 100, true)] } }));
  const sub = { id: "sub_me", itemId: "si_1", priceId: "price_promonthly", currentPeriodEnd: 2000 };
  const price = config.plans.find((plan) => plan.tier === "trainer_growth").prices.monthly;
  const preview = await gateway.previewChange(sub, price, "immediate", 1000);
  assert.equal(preview.amountDueNow, 2000);
  assert.deepEqual(preview.lines.map((entry) => [entry.kind, entry.tier, entry.amount]), [
    ["credit", "trainer_pro", -2900], ["charge", "trainer_growth", 4900],
  ], "lines outside the catalog are never shown");
  const scheduled = await gateway.previewChange({ ...sub, priceId: "price_growthmonthly" },
    config.plans.find((plan) => plan.tier === "trainer_pro").prices.monthly, "scheduled", 1000);
  assert.deepEqual(scheduled.lines, [], "nothing is charged today for a scheduled change");
});

test("the renewal exposes which plan Stripe will charge and whether it is discounted", () => {
  const { billingMetadata } = require("../../.build/trainer-billing/runtime");
  const { config } = fixture();
  const account = { userId: "u1", mode: "test", status: "active", tier: "trainer_scale", interval: "monthly",
    subscriptionId: "sub_1", customerId: "cus_1", paidUntil: new Date(Date.now() + 86400000), cancelAtPeriodEnd: false,
    renewal: { at: new Date("2026-10-18T00:00:00Z"), amount: 4410, subtotal: 4900, priceId: "price_growthmonthly", fingerprint: "x" } };
  const { billing } = billingMetadata({ ...config, enabled: true, errors: [] }, account, "stripe");
  assert.equal(billing.renewal.tier, "trainer_growth", "a scheduled phase is reported, not the current plan");
  assert.equal(billing.renewal.interval, "monthly");
  assert.equal(billing.renewal.discounted, true);
  const plain = billingMetadata({ ...config, enabled: true, errors: [] },
    { ...account, renewal: { ...account.renewal, amount: 4900 } }, "stripe").billing.renewal;
  assert.equal(plain.discounted, false);
  const cancelling = billingMetadata({ ...config, enabled: true, errors: [] }, { ...account, cancelAtPeriodEnd: true }, "stripe");
  assert.equal(cancelling.billing.renewal, null, "no renewal is announced once cancelled");
});

test("billing details are empty for accounts without a Stripe customer or pending deletion", async () => {
  const { config } = fixture();
  let called = 0;
  const gateway = { billingDetails: async () => { called++; return { invoices: [{ id: "x" }], paymentMethod: null }; } };
  const accounts = new Map([["none", { userId: "none", mode: "test" }], ["gone", { userId: "gone", customerId: "cus_1", deletedAt: new Date() }]]);
  const repository = { get: async (id) => accounts.get(id) || null };
  const service = new TrainerBillingService(config, repository, gateway);
  assert.deepEqual(await service.billingDetails("none"), { invoices: [], paymentMethod: null });
  assert.deepEqual(await service.billingDetails("gone"), { invoices: [], paymentMethod: null });
  assert.deepEqual(await service.billingDetails("missing"), { invoices: [], paymentMethod: null });
  assert.equal(called, 0);
});
