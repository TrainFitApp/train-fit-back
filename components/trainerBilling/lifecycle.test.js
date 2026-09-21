const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService, projection } = require("../../.build/trainer-billing/service");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { BillingError } = require("../../.build/trainer-billing/types");

// Lifecycle contract tests. Every provider operation and persistence layer is
// simulated; loading this file never loads dotenv or contacts Stripe/MongoDB.
const clone = (value) => structuredClone(value);
const USER_ID = "trainer-lifecycle";
const CUSTOMER_ID = "cus_lifecycle";
const SUBSCRIPTION_ID = "sub_lifecycle";
const nowSeconds = () => Math.floor(Date.now() / 1000);
const errorCode = (...codes) => (error) => error instanceof BillingError && codes.includes(error.code);

function config() {
  return loadConfig({
    NODE_ENV: "test", TRAINER_BILLING_ENABLED: "1", TRAINER_BILLING_MODE: "test",
    STRIPE_KEY: "rk_test_unit_test_placeholder", STRIPE_WEBHOOK_SECRET: "whsec_unit_test_placeholder",
    TRAINER_BILLING_FRONTEND_URL: "http://localhost:8100", TRAINER_BILLING_TAX_POLICY: "test_no_tax",
    STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_promonthly", STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_proannual",
    STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growthmonthly", STRIPE_TRAINER_GROWTH_ANNUAL_PRICE_ID: "price_growthannual",
    STRIPE_TRAINER_SCALE_MONTHLY_PRICE_ID: "price_scalemonthly", STRIPE_TRAINER_SCALE_ANNUAL_PRICE_ID: "price_scaleannual",
    STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit_test",
  });
}

function paidAccount(overrides = {}) {
  const periodEnd = nowSeconds() + 15 * 86400;
  return {
    userId: USER_ID, mode: "test", customerId: CUSTOMER_ID, subscriptionId: SUBSCRIPTION_ID,
    status: "active", tier: "trainer_pro", interval: "monthly", paidUntil: new Date(periodEnd * 1000),
    currentPeriodEnd: new Date(periodEnd * 1000), cancelAtPeriodEnd: false, revision: 1,
    ...overrides,
  };
}

function paidSubscription(overrides = {}) {
  const periodEnd = nowSeconds() + 15 * 86400;
  return {
    id: SUBSCRIPTION_ID, customerId: CUSTOMER_ID, status: "active", priceId: "price_promonthly",
    quantity: 1, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false,
    paid: true, paidPriceId: "price_promonthly", paidPeriodEnd: periodEnd,
    livemode: false, userId: USER_ID, scope: "trainers", itemId: "si_lifecycle",
    currentPeriodStart: nowSeconds() - 15 * 86400, scheduleId: null,
    latestInvoiceId: "in_paid_original", latestInvoiceStatus: "paid", pendingUpdate: false,
    collectionMethod: "charge_automatically", fingerprint: "original-paid-snapshot",
    ...overrides,
  };
}

class MemoryRepository {
  constructor(row) {
    this.accounts = new Map([[row.userId, clone(row)]]);
    this.users = new Map([[row.userId, {
      id: row.userId, email: "lifecycle@example.test",
      professionalPremium: { source: "stripe", entitled: true, tier: row.tier, expiresAt: row.paidUntil },
      premium: { source: "revenuecat", entitled: true, plan: "annual", marker: "consumer-stays-independent" },
    }]]);
    this.leases = new Set();
    this.events = new Map();
    this.saves = [];
    this.projections = [];
    this.usage = 5;
    this.failNextSave = false;
    this.failNextProjection = false;
  }
  async get(userId) { return clone(this.accounts.get(userId) || null); }
  async getUser(userId) { return clone(this.users.get(userId) || null); }
  async findCustomer(customerId) { return clone([...this.accounts.values()].find((row) => row.customerId === customerId) || null); }
  async withLock(userId, action) {
    if (this.leases.has(userId)) throw new BillingError("BILLING_BUSY", "Lifecycle fake lease is held");
    this.leases.add(userId);
    const row = clone(this.accounts.get(userId) || paidAccount({ userId, customerId: undefined, subscriptionId: null, status: "none", tier: null, paidUntil: null }));
    const save = async () => {
      if (this.failNextSave) { this.failNextSave = false; throw new Error("Simulated database save failure"); }
      row.revision += 1;
      this.accounts.set(userId, clone(row));
      this.saves.push(clone(row));
    };
    try { return await action(row, save); }
    finally { this.leases.delete(userId); }
  }
  async project(row, value) {
    if (this.failNextProjection) { this.failNextProjection = false; throw new Error("Simulated projection failure"); }
    this.projections.push({ userId: row.userId, value: clone(value) });
    const user = this.users.get(row.userId);
    if (user) user.professionalPremium = clone(value);
  }
  async saveEvent(record) {
    const current = this.events.get(record.eventId) || clone(record);
    current.attempts += 1;
    this.events.set(current.eventId, current);
    return clone(current);
  }
  async completeEvent(id) { this.events.get(id).status = "processed"; }
  async failEvent(id) { if (this.events.get(id).status !== "processed") this.events.get(id).status = "failed"; }
  async pendingEvents(limit) { return clone([...this.events.values()].filter((entry) => entry.status !== "processed").slice(0, limit)); }
  async accountsForReconciliation(limit) { return clone([...this.accounts.values()].slice(0, limit)); }
  async clientUsage(userId) { assert.equal(userId, USER_ID); return this.usage; }
}

class LifecycleGateway {
  constructor(row, repository) {
    this.subscription = clone(row);
    this.repository = repository;
    this.calls = [];
    this.mutations = [];
    this.idempotency = new Map();
    this.payments = new Map();
    this.previewAmount = 1000;
    this.previewRenewalAt = undefined;
    this.previewCreditBalance = undefined;
    this.failAfterUpgrade = false;
    this.failSaveAfterUpgrade = false;
    this.failAfterSchedule = false;
    this.failAfterCancellation = false;
    this.failAfterRelease = false;
    this.failAfterVoid = false;
  }
  called(name) { return this.calls.filter((call) => call.name === name); }
  mutated(name) { return this.mutations.filter((call) => call.name === name); }
  async listSubscriptions(customerId) {
    this.calls.push({ name: "listSubscriptions", customerId });
    return [clone(this.subscription)];
  }
  async listSessions() { return []; }
  async validatePrice(price) { this.calls.push({ name: "validatePrice", price: clone(price) }); }
  async previewChange(sub, price, kind, prorationDate) {
    this.calls.push({ name: "previewChange", sub: clone(sub), price: clone(price), kind, prorationDate });
    return { amountDueNow: kind === "scheduled" ? 0 : this.previewAmount, renewalAmount: price.amount,
      renewalAt: this.previewRenewalAt, creditBalance: this.previewCreditBalance };
  }
  updateFingerprint() {
    const sub = this.subscription;
    sub.fingerprint = JSON.stringify([sub.id, sub.priceId, sub.currentPeriodEnd, sub.cancelAtPeriodEnd,
      sub.scheduleId, sub.latestInvoiceId, sub.latestInvoiceStatus, sub.pendingUpdate]);
  }
  async applyUpgrade(quote, key) {
    this.calls.push({ name: "applyUpgrade", quote: clone(quote), key });
    const previous = this.idempotency.get(key);
    if (previous) return clone(previous);
    const result = { invoiceId: `in_change${this.mutated("applyUpgrade").length + 1}` };
    this.mutations.push({ name: "applyUpgrade", quote: clone(quote), key });
    this.idempotency.set(key, result);
    this.payments.set(result.invoiceId, { paid: false, voided: false, periodEnd: quote.periodEnd,
      url: "https://invoice.stripe.test/payment", quote: clone(quote) });
    this.subscription.pendingUpdate = true;
    this.subscription.pendingUpdateExpiresAt = nowSeconds() + 86400;
    this.subscription.latestInvoiceId = result.invoiceId;
    this.subscription.latestInvoiceStatus = "open";
    this.subscription.paid = false;
    this.updateFingerprint();
    if (this.failSaveAfterUpgrade) { this.failSaveAfterUpgrade = false; this.repository.failNextSave = true; }
    if (this.failAfterUpgrade) { this.failAfterUpgrade = false; throw new Error("Upgrade response lost after provider success"); }
    return clone(result);
  }
  async scheduleChange(quote, key) {
    this.calls.push({ name: "scheduleChange", quote: clone(quote), key });
    const previous = this.idempotency.get(key);
    if (previous) return clone(previous);
    const result = { scheduleId: `sub_sched_${this.mutated("scheduleChange").length + 1}` };
    this.idempotency.set(key, result);
    this.mutations.push({ name: "scheduleChange", quote: clone(quote), key });
    this.subscription.scheduleId = result.scheduleId;
    this.updateFingerprint();
    if (this.failAfterSchedule) { this.failAfterSchedule = false; throw new Error("Schedule response lost after provider success"); }
    return clone(result);
  }
  async changePayment(row, operation) {
    this.calls.push({ name: "changePayment", account: clone(row), operation: clone(operation) });
    const payment = this.payments.get(operation.invoiceId);
    if (!payment) return { paid: false, voided: false, periodEnd: 0 };
    const { quote, ...state } = payment;
    return clone(state);
  }
  settle(invoiceId, periodEnd) {
    const payment = this.payments.get(invoiceId);
    assert.ok(payment, "settle only a known change invoice");
    payment.paid = true;
    payment.periodEnd = periodEnd || payment.quote.periodEnd;
    this.subscription.priceId = payment.quote.targetPriceId;
    this.subscription.pendingUpdate = false;
    this.subscription.latestInvoiceStatus = "paid";
    this.subscription.paid = true;
    this.subscription.paidPriceId = payment.quote.targetPriceId;
    this.subscription.paidPeriodEnd = payment.periodEnd;
    this.subscription.currentPeriodEnd = payment.periodEnd;
    this.updateFingerprint();
  }
  async releaseSchedule(id, key) {
    this.calls.push({ name: "releaseSchedule", id, key });
    if (this.idempotency.has(key)) return;
    this.idempotency.set(key, {});
    this.mutations.push({ name: "releaseSchedule", id, key });
    this.subscription.scheduleId = null;
    this.updateFingerprint();
    if (this.failAfterRelease) { this.failAfterRelease = false; throw new Error("Release response lost after provider success"); }
  }
  async voidInvoice(id, key) {
    this.calls.push({ name: "voidInvoice", id, key });
    if (this.idempotency.has(key)) return;
    this.idempotency.set(key, {});
    this.mutations.push({ name: "voidInvoice", id, key });
    const payment = this.payments.get(id);
    assert.ok(payment && !payment.paid, "only unpaid change invoices may be voided");
    payment.voided = true;
    this.subscription.pendingUpdate = false;
    this.subscription.latestInvoiceStatus = "void";
    this.updateFingerprint();
    if (this.failAfterVoid) { this.failAfterVoid = false; throw new Error("Void response lost after provider success"); }
  }
  async setCancellation(id, cancel, key) {
    this.calls.push({ name: "setCancellation", id, cancel, key });
    if (this.idempotency.has(key)) return;
    this.idempotency.set(key, {});
    this.mutations.push({ name: "setCancellation", id, cancel, key });
    this.subscription.cancelAtPeriodEnd = cancel;
    this.updateFingerprint();
    if (this.failAfterCancellation) { this.failAfterCancellation = false; throw new Error("Cancellation response lost after provider success"); }
  }
  async cancelSubscription() { throw new Error("Lifecycle must never cancel a subscription immediately"); }
}

function setup({ tier = "trainer_pro", interval = "monthly", sub = {}, row = {} } = {}) {
  const settings = config();
  const plan = settings.plans.find((candidate) => candidate.tier === tier);
  const priceId = plan.prices[interval].id;
  const subscription = paidSubscription({ priceId, paidPriceId: priceId, ...sub });
  const account = paidAccount({ tier, interval, paidUntil: new Date(subscription.paidPeriodEnd * 1000),
    currentPeriodEnd: new Date(subscription.currentPeriodEnd * 1000), cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    provider: clone(subscription), ...row });
  const repository = new MemoryRepository(account);
  const gateway = new LifecycleGateway(subscription, repository);
  return { settings, repository, gateway, service: new TrainerBillingService(settings, repository, gateway) };
}

function professional(repository) { return repository.users.get(USER_ID).professionalPremium; }
const billingRejection = (error) => error instanceof BillingError;

test("lifecycle preview follows capacity and asymmetric interval-change policy", async (t) => {
  const cases = [
    ["capacity upgrade monthly", "trainer_pro", "monthly", "trainer_growth", "monthly", "immediate"],
    ["capacity upgrade annual", "trainer_pro", "annual", "trainer_scale", "annual", "immediate"],
    ["capacity downgrade monthly", "trainer_scale", "monthly", "trainer_pro", "monthly", "scheduled"],
    ["capacity downgrade annual", "trainer_growth", "annual", "trainer_pro", "annual", "scheduled"],
    ["monthly to annual", "trainer_pro", "monthly", "trainer_pro", "annual", "immediate"],
    ["annual to monthly", "trainer_growth", "annual", "trainer_growth", "monthly", "scheduled"],
    ["annual to monthly and capacity upgrade", "trainer_pro", "annual", "trainer_scale", "monthly", "scheduled"],
    ["annual to monthly and capacity downgrade", "trainer_scale", "annual", "trainer_pro", "monthly", "scheduled"],
    ["monthly to annual and capacity downgrade", "trainer_scale", "monthly", "trainer_pro", "annual", "immediate"],
  ];
  for (const [label, fromTier, fromInterval, toTier, toInterval, kind] of cases) await t.test(label, async () => {
    const { service, gateway, repository } = setup({ tier: fromTier, interval: fromInterval });
    const initialConsumer = clone(repository.users.get(USER_ID).premium);
    const quote = await service.previewChange(USER_ID, toTier, toInterval);
    assert.equal(quote.kind, kind);
    assert.equal(quote.from.tier, fromTier);
    assert.equal(quote.to.tier, toTier);
    assert.equal(quote.from.interval, fromInterval);
    assert.equal(quote.to.interval, toInterval);
    assert.equal(quote.currency, "eur");
    assert.equal(quote.amountDueNow, kind === "scheduled" ? 0 : 1000);
    assert.equal(gateway.called("previewChange")[0].kind, kind);
    assert.equal(gateway.mutations.length, 0, "preview must never charge or schedule");
    assert.equal((await repository.get(USER_ID)).quote.quoteId, quote.quoteId);
    assert.deepEqual(repository.users.get(USER_ID).premium, initialConsumer);
  });
});

test("preview rejects the current plan and an arbitrary provider price", async () => {
  const { service, gateway } = setup();
  await assert.rejects(service.previewChange(USER_ID, "trainer_pro", "monthly"), billingRejection);
  await assert.rejects(service.previewChange(USER_ID, "price_foreign", "monthly"), errorCode("INVALID_PLAN"));
  assert.equal(gateway.called("previewChange").length, 0);
  assert.equal(gateway.mutations.length, 0);
});

test("a frozen provider clock anchors the quote and every confirmation retry to the same proration timestamp", async () => {
  const frozenTime = nowSeconds() - 3600;
  const { service, gateway, repository } = setup({ sub: { billingNow: frozenTime } });
  assert.ok(gateway.subscription.currentPeriodStart < frozenTime);
  assert.ok(gateway.subscription.currentPeriodEnd > frozenTime);
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  assert.equal((await repository.get(USER_ID)).quote.prorationDate, frozenTime);
  assert.equal(gateway.called("previewChange")[0].prorationDate, frozenTime);
  assert.equal(new Date(quote.effectiveAt).getTime(), frozenTime * 1000);

  gateway.failAfterUpgrade = true;
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), /response lost/);
  const retry = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(retry.status, "payment_pending");
  assert.ok(gateway.called("previewChange").length >= 2);
  assert.ok(gateway.called("previewChange").every((call) => call.prorationDate === frozenTime));
  assert.ok(gateway.called("applyUpgrade").length >= 2);
  assert.ok(gateway.called("applyUpgrade").every((call) => call.quote.prorationDate === frozenTime));
  assert.equal((await repository.get(USER_ID)).change.quote.prorationDate, frozenTime);
  assert.equal(gateway.mutated("applyUpgrade").length, 1);
});

test("subscriptions without a provider clock use the current wall time for proration", async () => {
  const { service, gateway, repository } = setup();
  assert.equal(gateway.subscription.billingNow, undefined);
  const before = nowSeconds();
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  const after = nowSeconds();
  const stored = (await repository.get(USER_ID)).quote;
  assert.ok(stored.prorationDate >= before && stored.prorationDate <= after);
  assert.equal(gateway.called("previewChange")[0].prorationDate, stored.prorationDate);
  assert.equal(new Date(quote.effectiveAt).getTime(), stored.prorationDate * 1000);
});

test("destination client capacity is enforced both when previewing and confirming a change", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_scale" });
  repository.usage = 21;
  await assert.rejects(service.previewChange(USER_ID, "trainer_pro", "monthly"), billingRejection);
  assert.equal(gateway.called("previewChange").length, 0);
  repository.usage = 20;
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  assert.equal(quote.usage.clients, 20);
  assert.equal(quote.usage.limit, 150, "usage reports the currently paid capacity");
  assert.equal(quote.to.clientLimit, 20, "destination capacity is independently enforced");
  repository.usage = 21;
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), billingRejection);
  assert.equal(gateway.mutations.length, 0, "another invite after preview must prevent confirmation");
});

test("an interval switch with a capacity downgrade still refuses excess clients", async () => {
  const { service, repository, gateway } = setup({ tier: "trainer_scale", interval: "annual" });
  repository.usage = 51;
  await assert.rejects(service.previewChange(USER_ID, "trainer_growth", "monthly"), billingRejection);
  assert.equal(gateway.mutations.length, 0);
});

test("quotes belong to an authenticated account and arbitrary/foreign quote IDs cannot mutate subscriptions", async () => {
  const { service, gateway, repository } = setup();
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  await assert.rejects(service.changePlan(USER_ID, "quote-not-stored"), billingRejection);
  await assert.rejects(service.changePlan("other-user", quote.quoteId), billingRejection);
  assert.equal(gateway.mutations.length, 0);
  assert.equal((await repository.get(USER_ID)).quote.quoteId, quote.quoteId);
});

test("expired quote and changed provider snapshot require a new preview before charging", async (t) => {
  await t.test("expiry", async () => {
    const { service, gateway, repository } = setup();
    const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
    repository.accounts.get(USER_ID).quote.expiresAt = new Date(Date.now() - 1);
    await assert.rejects(service.changePlan(USER_ID, quote.quoteId), billingRejection);
    assert.equal(gateway.mutations.length, 0);
  });
  await t.test("provider snapshot", async () => {
    const { service, gateway } = setup();
    const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
    gateway.subscription.fingerprint = "different-provider-snapshot";
    await assert.rejects(service.changePlan(USER_ID, quote.quoteId), billingRejection);
    assert.equal(gateway.mutations.length, 0);
  });
});

test("an unpaid immediate upgrade persists a retryable operation while keeping the paid tier and expiry", async () => {
  const { service, gateway, repository } = setup();
  const before = await repository.get(USER_ID);
  const consumer = clone(repository.users.get(USER_ID).premium);
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  const result = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(result.status, "payment_pending");
  assert.match(result.paymentActionUrl, /^https:\/\/invoice\.stripe\.test\//);
  const stored = await repository.get(USER_ID);
  assert.equal(stored.change.quote.quoteId, quote.quoteId);
  assert.equal(stored.change.status, "payment_pending");
  assert.equal(stored.change.invoiceId, "in_change1");
  assert.equal(professional(repository).tier, "trainer_pro");
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  assert.equal(professional(repository).entitled, true);
  assert.deepEqual(repository.users.get(USER_ID).premium, consumer);
  const retry = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(retry.status, "payment_pending");
  assert.equal(gateway.mutated("applyUpgrade").length, 1);
});

test("only a confirmed paid change grants the new tier; repeated events keep consumer billing separate", async () => {
  const { service, gateway, repository } = setup();
  const consumer = clone(repository.users.get(USER_ID).premium);
  const quote = await service.previewChange(USER_ID, "trainer_scale", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  const invoiceId = (await repository.get(USER_ID)).change.invoiceId;
  gateway.settle(invoiceId);
  const paidEvent = { eventId: "evt_lifecycle_paid", type: "invoice.paid", customerId: CUSTOMER_ID, mode: "test", status: "pending", attempts: 0 };
  await service.event(paidEvent);
  await service.event(paidEvent);
  assert.equal(professional(repository).tier, "trainer_scale");
  assert.equal(professional(repository).entitled, true);
  assert.equal((await repository.get(USER_ID)).change.status, "applied");
  assert.deepEqual(repository.users.get(USER_ID).premium, consumer);
});

test("monthly-to-annual changes show the new renewal date and remain unpaid until invoice settlement", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_scale", interval: "monthly" });
  const before = await repository.get(USER_ID);
  const renewalAt = nowSeconds() + 365 * 86400;
  gateway.previewRenewalAt = renewalAt;
  const quote = await service.previewChange(USER_ID, "trainer_pro", "annual");
  assert.equal(quote.kind, "immediate");
  assert.equal(new Date(quote.nextRenewal.at).getTime(), renewalAt * 1000);
  await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(professional(repository).tier, "trainer_scale");
  assert.equal(professional(repository).plan, "monthly");
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  gateway.settle((await repository.get(USER_ID)).change.invoiceId, renewalAt);
  await service.sync(USER_ID);
  assert.equal(professional(repository).tier, "trainer_pro");
  assert.equal(professional(repository).plan, "annual");
  assert.equal(professional(repository).expiresAt.getTime(), renewalAt * 1000);
});

test("upgrade retries recover a lost provider response with the same idempotency key", async () => {
  const { service, gateway, repository } = setup();
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  gateway.failAfterUpgrade = true;
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), /response lost/);
  const interrupted = await repository.get(USER_ID);
  assert.equal(interrupted.change.quote.quoteId, quote.quoteId);
  assert.equal(interrupted.change.status, "processing");
  const retry = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(retry.status, "payment_pending");
  assert.equal(gateway.mutated("applyUpgrade").length, 1);
  assert.ok(gateway.called("applyUpgrade").length >= 2);
  assert.equal(new Set(gateway.called("applyUpgrade").map((call) => call.key)).size, 1);
});

test("provider success followed by a local save failure does not create a second upgrade invoice", async () => {
  const { service, gateway, repository } = setup();
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  gateway.failSaveAfterUpgrade = true;
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), /database save failure/);
  await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(gateway.mutated("applyUpgrade").length, 1);
  assert.equal((await repository.get(USER_ID)).change.invoiceId, "in_change1");
});

test("downgrade schedules the next period and duplicate confirmation never creates another schedule", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_scale" });
  const before = await repository.get(USER_ID);
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  const first = await service.changePlan(USER_ID, quote.quoteId);
  const repeated = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(first.status, "scheduled");
  assert.equal(repeated.status, "scheduled");
  assert.equal(gateway.mutated("scheduleChange").length, 1);
  assert.equal(gateway.mutated("applyUpgrade").length, 0);
  assert.equal(new Date(quote.effectiveAt).getTime(), before.currentPeriodEnd.getTime());
  assert.equal(professional(repository).tier, "trainer_scale");
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
});

test("a scheduled change whose response was lost retries the original provider operation", async () => {
  const { service, gateway } = setup({ tier: "trainer_scale" });
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  gateway.failAfterSchedule = true;
  await assert.rejects(service.changePlan(USER_ID, quote.quoteId), /response lost/);
  const result = await service.changePlan(USER_ID, quote.quoteId);
  assert.equal(result.status, "scheduled");
  assert.equal(gateway.mutated("scheduleChange").length, 1);
  assert.equal(new Set(gateway.called("scheduleChange").map((call) => call.key)).size, 1);
});

test("discarding a scheduled downgrade releases the schedule, never cancels the current subscription", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_scale" });
  const before = await repository.get(USER_ID);
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  await service.discardChange(USER_ID);
  assert.equal(gateway.mutated("releaseSchedule").length, 1);
  assert.equal(gateway.mutated("setCancellation").length, 0);
  assert.equal(gateway.subscription.scheduleId, null);
  assert.equal(gateway.subscription.status, "active");
  assert.equal(professional(repository).tier, "trainer_scale");
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  assert.equal((await repository.get(USER_ID)).change.status, "discarded");
});

test("discard release retries after a lost response without canceling the subscription", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_scale" });
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  gateway.failAfterRelease = true;
  await assert.rejects(service.discardChange(USER_ID), /response lost/);
  await service.discardChange(USER_ID);
  assert.equal(gateway.mutated("releaseSchedule").length, 1);
  assert.equal(new Set(gateway.called("releaseSchedule").map((call) => call.key)).size, 1);
  assert.equal(gateway.subscription.status, "active");
  assert.equal((await repository.get(USER_ID)).change.status, "discarded");
});

test("discarding an unpaid upgrade voids only that invoice and retains the old paid access", async () => {
  const { service, gateway, repository } = setup();
  const before = await repository.get(USER_ID);
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  await service.discardChange(USER_ID);
  assert.equal(gateway.mutated("voidInvoice").length, 1);
  assert.equal(gateway.mutated("voidInvoice")[0].id, "in_change1");
  assert.equal(gateway.mutated("setCancellation").length, 0);
  assert.equal(professional(repository).tier, "trainer_pro");
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  assert.equal((await repository.get(USER_ID)).change.status, "discarded");
});

test("after discarding an unpaid change the paid original plan remains eligible for a fresh proposal", async () => {
  const { service, gateway, repository } = setup();
  const first = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  await service.changePlan(USER_ID, first.quoteId);
  await service.discardChange(USER_ID);
  assert.equal(gateway.subscription.latestInvoiceStatus, "void");
  assert.equal(professional(repository).entitled, true);
  const replacement = await service.previewChange(USER_ID, "trainer_scale", "monthly");
  assert.equal(replacement.to.tier, "trainer_scale");
  assert.notEqual(replacement.quoteId, first.quoteId);
  assert.equal(gateway.mutated("applyUpgrade").length, 1, "new preview does not charge again");
});

test("preview refuses deletion-pending accounts before recovering any unsubmitted paid change", async () => {
  const { service, gateway, repository } = setup();
  await service.previewChange(USER_ID, "trainer_growth", "monthly");
  const stored = repository.accounts.get(USER_ID);
  stored.change = { quote: clone(stored.quote), startedAt: new Date(), status: "processing" };
  stored.deletedAt = new Date();
  await assert.rejects(service.previewChange(USER_ID, "trainer_scale", "monthly"), errorCode("ACCOUNT_DELETION_PENDING"));
  assert.equal(gateway.called("applyUpgrade").length, 0, "a preview must not recover a charge for an account being deleted");
  assert.equal(gateway.mutations.length, 0);
});

test("cancel and resume only change renewal, retain paid access and are safe to repeat", async () => {
  const { service, gateway, repository } = setup();
  const before = await repository.get(USER_ID);
  await service.cancel(USER_ID);
  await service.cancel(USER_ID);
  assert.equal(gateway.subscription.cancelAtPeriodEnd, true);
  assert.equal((await repository.get(USER_ID)).cancelAtPeriodEnd, true);
  assert.equal(professional(repository).entitled, true);
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  assert.equal(projection(await repository.get(USER_ID), before.paidUntil).entitled, false);
  await service.resume(USER_ID);
  await service.resume(USER_ID);
  assert.equal(gateway.subscription.cancelAtPeriodEnd, false);
  assert.equal((await repository.get(USER_ID)).cancelAtPeriodEnd, false);
  assert.equal(professional(repository).expiresAt.getTime(), before.paidUntil.getTime());
  assert.deepEqual(gateway.mutated("setCancellation").map((call) => call.cancel), [true, false]);
});

test("cancel recovers a lost response by finishing the persisted control operation", async () => {
  const { service, gateway, repository } = setup();
  gateway.failAfterCancellation = true;
  await assert.rejects(service.cancel(USER_ID), /response lost/);
  assert.equal((await repository.get(USER_ID)).control.kind, "cancel");
  await service.cancel(USER_ID);
  assert.equal((await repository.get(USER_ID)).cancelAtPeriodEnd, true);
  assert.equal(gateway.mutated("setCancellation").length, 1);
  assert.equal(new Set(gateway.called("setCancellation").map((call) => call.key)).size, 1);
});

test("reconciliation finishes a lost cancellation response without another user request", async () => {
  const { service, gateway, repository } = setup();
  gateway.failAfterCancellation = true;
  await assert.rejects(service.cancel(USER_ID), /response lost/);
  assert.equal((await repository.get(USER_ID)).control.kind, "cancel");
  assert.notEqual((await repository.get(USER_ID)).control.done, true);
  await service.reconcile();
  const recovered = await repository.get(USER_ID);
  assert.equal(recovered.control.done, true);
  assert.equal(recovered.cancelAtPeriodEnd, true);
  assert.equal(professional(repository).entitled, true);
  assert.equal(gateway.mutated("setCancellation").length, 1);
  assert.equal(new Set(gateway.called("setCancellation").map((call) => call.key)).size, 1);
});

test("resume preserves an unpaid upgrade when cancellation was requested outside this app", async () => {
  const { service, gateway, repository } = setup();
  const quote = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  const invoiceId = (await repository.get(USER_ID)).change.invoiceId;
  // E.g. the customer cancels renewal in Stripe's portal while a change invoice
  // still awaits authentication/payment. Resume must affect renewal alone.
  gateway.subscription.cancelAtPeriodEnd = true;
  gateway.updateFingerprint();
  await service.resume(USER_ID);
  const resumed = await repository.get(USER_ID);
  assert.equal(resumed.cancelAtPeriodEnd, false);
  assert.equal(resumed.change.status, "payment_pending");
  assert.equal(resumed.change.invoiceId, invoiceId);
  assert.match(resumed.pendingPayment.url, /^https:\/\/invoice\.stripe\.test\//);
  assert.equal(gateway.mutated("voidInvoice").length, 0);
  assert.equal(gateway.mutated("releaseSchedule").length, 0);
  assert.equal(professional(repository).tier, "trainer_pro");
  gateway.settle(invoiceId);
  await service.sync(USER_ID);
  assert.equal((await repository.get(USER_ID)).change.status, "applied");
  assert.equal(professional(repository).tier, "trainer_growth");
});

test("lifecycle operations refuse deleted accounts and subscriptions belonging to another user", async (t) => {
  for (const method of ["previewChange", "cancel", "resume", "discardChange"]) await t.test(method, async () => {
    const { service, gateway } = setup({ row: { deletedAt: new Date() } });
    await assert.rejects(service[method](USER_ID, "trainer_growth", "monthly"), errorCode("ACCOUNT_DELETION_PENDING"));
    assert.equal(gateway.mutations.length, 0);
    const foreign = setup({ sub: { userId: "someone-else" } });
    await assert.rejects(foreign.service[method](USER_ID, "trainer_growth", "monthly"), billingRejection);
    assert.equal(foreign.gateway.mutations.length, 0);
  });
});

test("a scheduled downgrade can be replaced by an immediate upgrade: old schedule released before charging", async () => {
  const { service, gateway, repository } = setup({ tier: "trainer_growth" });
  const downgrade = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  await service.changePlan(USER_ID, downgrade.quoteId);
  const oldSchedule = gateway.subscription.scheduleId;
  assert.ok(oldSchedule);
  const upgrade = await service.previewChange(USER_ID, "trainer_scale", "monthly");
  assert.equal(upgrade.kind, "immediate");
  const result = await service.changePlan(USER_ID, upgrade.quoteId);
  assert.equal(result.status, "payment_pending");
  const release = gateway.mutated("releaseSchedule");
  assert.equal(release.length, 1);
  assert.equal(release[0].id, oldSchedule);
  const releaseAt = gateway.mutations.indexOf(release[0]);
  assert.ok(releaseAt < gateway.mutations.indexOf(gateway.mutated("applyUpgrade")[0]), "release must precede the new charge");
  assert.equal(gateway.mutated("setCancellation").length, 0);
  // Paid access stays on Growth until the upgrade invoice is paid.
  assert.equal(professional(repository).tier, "trainer_growth");
});

test("a scheduled downgrade can be replaced by another scheduled change without duplicating schedules", async () => {
  const { service, gateway } = setup({ tier: "trainer_scale" });
  const first = await service.previewChange(USER_ID, "trainer_growth", "monthly");
  await service.changePlan(USER_ID, first.quoteId);
  const firstSchedule = gateway.subscription.scheduleId;
  const second = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  assert.equal(second.kind, "scheduled");
  assert.equal(second.nextRenewal.amount, 2900, "with a schedule attached the renewal is the target tariff");
  const result = await service.changePlan(USER_ID, second.quoteId);
  assert.equal(result.status, "scheduled");
  assert.equal(gateway.mutated("releaseSchedule")[0].id, firstSchedule);
  assert.equal(gateway.mutated("scheduleChange").length, 2);
  assert.notEqual(gateway.subscription.scheduleId, firstSchedule);
  const repeated = await service.changePlan(USER_ID, second.quoteId);
  assert.equal(repeated.status, "scheduled");
  assert.equal(gateway.mutated("scheduleChange").length, 2);
});

test("choosing the change that is already scheduled is refused instead of rescheduling it", async () => {
  const { service, gateway } = setup({ tier: "trainer_scale" });
  const quote = await service.previewChange(USER_ID, "trainer_pro", "monthly");
  await service.changePlan(USER_ID, quote.quoteId);
  await assert.rejects(service.previewChange(USER_ID, "trainer_pro", "monthly"), errorCode("SAME_SCHEDULED_CHANGE"));
  await assert.rejects(service.previewChange(USER_ID, "trainer_scale", "monthly"), errorCode("SAME_PLAN"));
  assert.equal(gateway.mutated("scheduleChange").length, 1);
});

test("a failed renewal exposes its open invoice; a pending change invoice does not", async () => {
  const renewal = setup({ sub: { status: "past_due", latestInvoiceId: "in_renewal", latestInvoiceStatus: "open",
    latestInvoiceUrl: "https://invoice.stripe.com/i/renewal", latestInvoiceAmountDue: 2900, paid: false } });
  await renewal.service.sync(USER_ID);
  const row = await renewal.repository.get(USER_ID);
  assert.deepEqual(row.renewalPayment, { url: "https://invoice.stripe.com/i/renewal", amount: 2900, invoiceId: "in_renewal" });

  const change = setup();
  const quote = await change.service.previewChange(USER_ID, "trainer_growth", "monthly");
  await change.service.changePlan(USER_ID, quote.quoteId);
  change.gateway.subscription.status = "past_due";
  await change.service.sync(USER_ID);
  assert.equal((await change.repository.get(USER_ID)).renewalPayment, null);
});

test("a full refund of the charge paying the current period ends paid access immediately", async () => {
  const { service, gateway, repository } = setup();
  gateway.invoiceForPayment = async () => ({ invoiceId: "in_paid_original", subscriptionId: SUBSCRIPTION_ID, customerId: CUSTOMER_ID });
  const cancelled = [];
  gateway.cancelSubscription = async (id) => { cancelled.push(id); gateway.subscription.status = "canceled"; gateway.updateFingerprint(); };
  await service.event({ eventId: "evt_refund", type: "charge.refunded", customerId: CUSTOMER_ID, mode: "test",
    status: "pending", attempts: 0, detail: { chargeId: "ch_1", paymentIntentId: "pi_1", fullyRefunded: true } });
  assert.deepEqual(cancelled, [SUBSCRIPTION_ID]);
  assert.equal(professional(repository).entitled, false);
  assert.equal((await repository.get(USER_ID)).status, "canceled");
  // The same event redelivered does nothing more.
  await service.event({ eventId: "evt_refund", type: "charge.refunded", customerId: CUSTOMER_ID, mode: "test",
    status: "pending", attempts: 0, detail: { chargeId: "ch_1", paymentIntentId: "pi_1", fullyRefunded: true } });
  assert.equal(cancelled.length, 1);
});

test("partial refunds, refunds of older invoices and disputes never change access; they flag the account", async (t) => {
  for (const [label, detail, invoiceId] of [
    ["partial", { chargeId: "ch_p", paymentIntentId: "pi_p", fullyRefunded: false }, "in_paid_original"],
    ["older invoice", { chargeId: "ch_o", paymentIntentId: "pi_o", fullyRefunded: true }, "in_older"],
  ]) await t.test(label, async () => {
    const { service, gateway, repository } = setup();
    gateway.invoiceForPayment = async () => ({ invoiceId, subscriptionId: SUBSCRIPTION_ID, customerId: CUSTOMER_ID });
    gateway.cancelSubscription = async () => { throw new Error("must not cancel"); };
    await service.event({ eventId: `evt_${label}`, type: "charge.refunded", customerId: CUSTOMER_ID, mode: "test",
      status: "pending", attempts: 0, detail });
    assert.equal(professional(repository).entitled, true);
    assert.equal((await repository.get(USER_ID)).review.reason, "refund");
  });
  await t.test("dispute without a customer on the event", async () => {
    const { service, gateway, repository } = setup();
    gateway.invoiceForPayment = async () => ({ invoiceId: "in_paid_original", subscriptionId: SUBSCRIPTION_ID, customerId: CUSTOMER_ID });
    gateway.cancelSubscription = async () => { throw new Error("must not cancel"); };
    await service.event({ eventId: "evt_dispute", type: "charge.dispute.created", customerId: null, mode: "test",
      status: "pending", attempts: 0, detail: { disputeId: "dp_1", paymentIntentId: "pi_1" } });
    assert.equal(professional(repository).entitled, true);
    assert.deepEqual({ ...(await repository.get(USER_ID)).review, at: undefined }, { reason: "dispute", reference: "dp_1", at: undefined });
  });
});

test("a failed renewal keeps the paid plan for 7 days of grace, then falls back to Free", () => {
  const renewalFailedAt = new Date("2026-10-18T12:00:00Z");
  const row = paidAccount({ status: "past_due", paidUntil: renewalFailedAt });
  const day = 86400000;
  const within = projection(row, new Date(renewalFailedAt.getTime() + 6 * day));
  assert.equal(within.entitled, true);
  assert.equal(within.expiresAt.getTime(), renewalFailedAt.getTime() + 7 * day);
  assert.equal(projection(row, new Date(renewalFailedAt.getTime() + 8 * day)).entitled, false);
  const active = projection(paidAccount({ paidUntil: renewalFailedAt }), new Date(renewalFailedAt.getTime() + day));
  assert.equal(active.entitled, false, "grace applies only while Stripe retries a past_due renewal");
  assert.equal(projection(paidAccount({ status: "unpaid", paidUntil: renewalFailedAt }), renewalFailedAt).entitled, false);
});

test("the next renewal comes from Stripe, is cached per subscription snapshot and hidden once cancelled", async () => {
  const { service, gateway, repository } = setup();
  let calls = 0;
  gateway.upcomingRenewal = async (sub) => { calls++; return { at: sub.currentPeriodEnd, amount: 2610, priceId: sub.priceId, subtotal: 2900 }; };
  await service.sync(USER_ID);
  await service.sync(USER_ID);
  const row = await repository.get(USER_ID);
  assert.equal(row.renewal.amount, 2610, "coupon-discounted amount from Stripe, not the tariff");
  assert.equal(calls, 1);
  await service.cancel(USER_ID);
  assert.equal((await repository.get(USER_ID)).renewal, null);

  const failing = setup();
  failing.gateway.upcomingRenewal = async () => { throw new Error("preview unavailable"); };
  await failing.service.sync(USER_ID);
  assert.equal((await failing.repository.get(USER_ID)).renewal, null, "a preview failure never blocks the refresh");
});
