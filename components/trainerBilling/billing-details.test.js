const test = require("node:test");
const assert = require("node:assert/strict");
const { StripeGateway } = require("../../.build/trainer-billing/stripe-gateway");
const { TrainerBillingService } = require("../../.build/trainer-billing/service");
const { admissionSeats, billingMetadata } = require("../../.build/trainer-billing/runtime");
const { stateView } = require("../../.build/trainer-billing/config");
const { catalogStripePrices, priceId, sandboxConfig, state, subscription } = require("./test-support");

// Facturas, método de pago y desglose del prorrateo: todo sale de Stripe; aquí
// solo se comprueba el filtrado de seguridad y el etiquetado, sin red.
function fixture() {
  const config = sandboxConfig();
  return { config, gateway: new StripeGateway(config) };
}
const line = (price, amount, proration, start = 1000, end = 2000, quantity = 1) => ({ amount, quantity,
  pricing: { price_details: { price } }, period: { start, end },
  parent: { type: "subscription_item_details", subscription_item_details: { proration, subscription_item: "si_1" } } });

test("invoice history keeps only this customer's finalized invoices and Stripe-hosted links", async (t) => {
  const { gateway } = fixture();
  const base = { livemode: false, customer: "cus_me", currency: "eur", total: 2900, amount_paid: 2900, amount_due: 0,
    created: 1790000000, lines: { data: [line(priceId("base", "starter", "monthly"), 2900, false)] } };
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
  assert.deepEqual(details.paymentMethod, { brand: "visa", last4: "4242", expMonth: 9, expYear: 2027, kind: "card", wallet: null });
});

test("Link and card wallets are shown as such instead of disappearing", async (t) => {
  const { gateway } = fixture();
  t.mock.method(gateway.stripe.invoices, "list", async () => ({ data: [] }));
  const retrieve = t.mock.method(gateway.stripe.subscriptions, "retrieve", async () => ({ livemode: false, customer: "cus_me",
    default_payment_method: { type: "link", link: { email: "t@example.test" } } }));
  assert.deepEqual((await gateway.billingDetails("cus_me", "sub_me")).paymentMethod,
    { brand: "link", last4: "", expMonth: 0, expYear: 0, kind: "link", wallet: null });
  retrieve.mock.mockImplementation(async () => ({ livemode: false, customer: "cus_me", default_payment_method: { type: "card",
    card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2030, wallet: { type: "apple_pay" } } } }));
  assert.equal((await gateway.billingDetails("cus_me", "sub_me")).paymentMethod.wallet, "apple_pay");
});

test("the payment method is optional: a permission error hides it instead of failing the page", async (t) => {
  const { gateway } = fixture();
  t.mock.method(gateway.stripe.invoices, "list", async () => ({ data: [] }));
  t.mock.method(gateway.stripe.subscriptions, "retrieve", async () => { throw Object.assign(new Error("perm"), { code: "more_permissions_required" }); });
  assert.deepEqual(await gateway.billingDetails("cus_me", "sub_me"), { invoices: [], paymentMethod: null });
});

test("el desglose de la propuesta etiqueta cuota y plazas por plan y nunca muestra líneas ajenas al catálogo", async (t) => {
  const { gateway } = fixture();
  const prices = catalogStripePrices();
  t.mock.method(gateway.stripe.prices, "list", async () => ({ data: structuredClone(prices) }));
  t.mock.method(gateway.stripe.prices, "retrieve", async (id) => ({ id, livemode: false, metadata: {}, type: "one_time" }));
  t.mock.method(gateway.stripe.invoices, "createPreview", async (params) => ({ livemode: false, currency: "eur",
    amount_due: 2000, ending_balance: 0, lines: { has_more: false, data: params.subscription_details.proration_behavior === "none"
      ? [line(priceId("base", "professional", "monthly"), 4900, false)]
      : [line(priceId("base", "starter", "monthly"), -1450, true), line(priceId("seat", "starter", "monthly"), -250, true, 1000, 2000, 5),
        line(priceId("base", "professional", "monthly"), 2450, true), line("price_unknown", 100, true)] } }));
  const preview = await gateway.previewChange(subscription(state("starter", "monthly", 5)), state("professional"), "immediate", 1000);
  assert.equal(preview.amountDueNow, 2000);
  assert.deepEqual(preview.lines.map((entry) => [entry.kind, entry.item, entry.tier, entry.quantity, entry.amount]), [
    ["credit", "base", "starter", 1, -1450], ["credit", "seat", "starter", 5, -250], ["charge", "base", "professional", 1, 2450],
  ], "lines outside the catalog are never shown");
});

test("la ficha expone lo contratado, el cambio programado y el plan que cobrará Stripe en la renovación", () => {
  const config = sandboxConfig();
  const account = { userId: "u1", mode: "test", status: "active", tier: "starter", interval: "monthly", extraSeats: 10,
    subscriptionId: "sub_1", customerId: "cus_1", paidUntil: new Date(Date.now() + 86400000), cancelAtPeriodEnd: false,
    provider: { latestInvoiceStatus: "paid" },
    change: { status: "scheduled", quote: { to: stateView(state("starter", "monthly", 2)), effectiveAt: new Date("2026-10-18T00:00:00Z") } },
    renewal: { at: new Date("2026-10-18T00:00:00Z"), amount: 2790, subtotal: 3100, state: state("starter", "monthly", 2), fingerprint: "x" } };
  const { billing } = billingMetadata(config, account);
  assert.deepEqual(billing.current, { tier: "starter", interval: "monthly", extraSeats: 10, seats: 30, amount: 3900 });
  assert.equal(billing.pendingChange.seats, 22);
  assert.equal(billing.renewal.state.seats, 22, "a scheduled phase is reported, not the current plan");
  assert.equal(billing.renewal.discounted, true);
  assert.equal(billingMetadata(config, { ...account, renewal: { ...account.renewal, amount: 3100 } }).billing.renewal.discounted, false);
  assert.equal(billingMetadata(config, { ...account, cancelAtPeriodEnd: true }).billing.renewal, null, "no renewal is announced once cancelled");
  // Con la bajada programada, las altas nuevas ya cuentan con las plazas del destino.
  assert.equal(admissionSeats(30, account), 22);
  assert.equal(admissionSeats(30, { ...account, change: { ...account.change, status: "applied" } }), 30);
  assert.equal(admissionSeats(3, null), 3);
  // Free sin suscripción: nada contratado que gestionar.
  assert.equal(billingMetadata(config, null).billing.current, null);
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
