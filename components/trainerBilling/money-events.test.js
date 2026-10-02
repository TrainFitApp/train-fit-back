const test = require("node:test");
const assert = require("node:assert/strict");
const { TrainerBillingService, effectiveAccess, projection } = require("../../.build/trainer-billing/service");
const { classifyInvoice, fundingRole } = require("../../.build/trainer-billing/financing");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { billingMetadata } = require("../../.build/trainer-billing/runtime");
const { BillingError } = require("../../.build/trainer-billing/types");

// Política de dinero 2026-09-28 (reembolsos, disputas, avisos de fraude, intervenciones y avisos de
// renovación). Todo con dobles en memoria: este fichero nunca carga dotenv ni contacta Stripe/MongoDB.
const clone = (value) => structuredClone(value);
const USER = "trainer-money";
const CUS = "cus_money";
const SUB = "sub_money";
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const code = (...codes) => (error) => error instanceof BillingError && codes.includes(error.code);
const ADMIN = { id: "admin-1", email: "admin@example.test" };

function config() {
  return loadConfig({ NODE_ENV: "test", TRAINER_BILLING_ENABLED: "1", TRAINER_BILLING_MODE: "test",
    STRIPE_KEY: "rk_test_unit_test_placeholder", STRIPE_WEBHOOK_SECRET: "whsec_unit_test_placeholder",
    TRAINER_BILLING_FRONTEND_URL: "http://localhost:8100", TRAINER_BILLING_TAX_POLICY: "test_no_tax",
    TRAINER_BILLING_SUPPORT_EMAIL: "facturacion@example.test",
    STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID: "price_promonthly", STRIPE_TRAINER_PRO_ANNUAL_PRICE_ID: "price_proannual",
    STRIPE_TRAINER_GROWTH_MONTHLY_PRICE_ID: "price_growthmonthly", STRIPE_TRAINER_GROWTH_ANNUAL_PRICE_ID: "price_growthannual",
    STRIPE_TRAINER_SCALE_MONTHLY_PRICE_ID: "price_scalemonthly", STRIPE_TRAINER_SCALE_ANNUAL_PRICE_ID: "price_scaleannual",
    STRIPE_TRAINER_PORTAL_CONFIGURATION_ID: "bpc_unit_test" });
}

// Qué financió un pago (lo que devolvería gateway.paymentContext tras clasificar la factura).
function financed(kind, overrides = {}) {
  return { kind, invoiceId: "in_period", subscriptionId: SUB, customerId: CUS, tier: "trainer_pro", interval: "monthly",
    priceId: "price_promonthly", fromTier: null, fromInterval: null, fromPriceId: null,
    periodStart: nowS() - 15 * DAY, periodEnd: nowS() + 15 * DAY, amountPaid: 2900, currency: "eur", ...overrides };
}
const upgradeInvoice = () => financed("upgrade", { invoiceId: "in_upgrade", tier: "trainer_growth", priceId: "price_growthmonthly",
  fromTier: "trainer_pro", fromInterval: "monthly", fromPriceId: "price_promonthly", periodStart: nowS() - 5 * DAY, amountPaid: 1000 });
function payment(chargeId, what, refunds = []) {
  const moving = refunds.filter((refund) => !["failed", "canceled"].includes(refund.status)).reduce((sum, refund) => sum + refund.amount, 0);
  return { chargeId, paymentIntentId: `pi_${chargeId}`, customerId: CUS, amount: what.amountPaid, amountRefunded: moving,
    refunded: moving >= what.amountPaid, currency: "eur", refunds, financed: what };
}
const refund = (id, amount, status = "succeeded", reason = "requested_by_customer") =>
  ({ id, amount, status, reason, failureReason: status === "failed" ? "expired_or_canceled_card" : null, createdAt: new Date() });
const event = (eventId, type, detail, customerId = null) => ({ eventId, type, customerId, mode: "test", status: "pending", attempts: 0, detail });

class Repository {
  constructor(row) {
    this.accounts = new Map([[row.userId, clone(row)]]);
    this.users = new Map([[row.userId, { id: row.userId, email: "trainer@example.test",
      professionalPremium: { source: "stripe", entitled: true, tier: row.tier, expiresAt: row.paidUntil } }]]);
    this.events = new Map();
    this.cases = new Map();
    this.interventions = [];
    this.leases = new Set();
  }
  async get(userId) { return clone(this.accounts.get(userId) || null); }
  async getUser(userId) { return clone(this.users.get(userId) || null); }
  async findCustomer(customerId) { return clone([...this.accounts.values()].find((row) => row.customerId === customerId) || null); }
  async withLock(userId, action) {
    if (this.leases.has(userId)) throw new BillingError("BILLING_BUSY", "fake lease held");
    this.leases.add(userId);
    const row = clone(this.accounts.get(userId) || { userId, mode: "test", status: "none", cancelAtPeriodEnd: false, revision: 0 });
    const save = async () => { row.revision += 1; this.accounts.set(userId, clone(row)); };
    try { return await action(row, save); } finally { this.leases.delete(userId); }
  }
  async project(row, value) { const user = this.users.get(row.userId); if (user) user.professionalPremium = clone(value); }
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
  async clientUsage() { return 2; }
  async getCase(caseId) { return clone(this.cases.get(caseId) || null); }
  async saveCase(entry) { this.cases.set(entry.caseId, clone(entry)); }
  async listCases({ userId, status, limit }) {
    return clone([...this.cases.values()].filter((entry) => (!userId || entry.userId === userId) && (!status || entry.status === status)).slice(0, limit));
  }
  async saveIntervention(entry) { this.interventions.push(clone(entry)); }
  async updateIntervention(id, patch) { Object.assign(this.interventions.find((entry) => entry.interventionId === id), clone(patch)); }
  async listInterventions(userId) { return clone(this.interventions.filter((entry) => entry.userId === userId)); }
}

class Gateway {
  constructor(subscription) {
    this.subscription = subscription;
    this.payments = new Map();
    this.disputes = new Map();
    this.warnings = new Map();
    this.sessions = new Map();
    this.events = [];
    this.mutations = [];
    this.calls = [];
  }
  mutated(name) { return this.mutations.filter((entry) => entry.name === name); }
  fingerprint() {
    const sub = this.subscription;
    sub.fingerprint = JSON.stringify([sub.priceId, sub.status, sub.cancelAtPeriodEnd, sub.collectionPaused, sub.scheduleId, sub.latestInvoiceId]);
  }
  async listSubscriptions() { return [clone(this.subscription)]; }
  async listSessions() { return []; }
  async getSession(id) { return clone(this.sessions.get(id)); }
  async validatePrice() {}
  async previewChange() { return { amountDueNow: 1000, renewalAmount: 4900 }; }
  async changePayment() { return { paid: false, voided: false, periodEnd: 0 }; }
  async releaseSchedule(id, key) { this.mutations.push({ name: "releaseSchedule", id, key }); this.subscription.scheduleId = null; this.fingerprint(); }
  async voidInvoice() {}
  async setCancellation(id, cancel, key) { this.mutations.push({ name: "setCancellation", cancel, key }); this.subscription.cancelAtPeriodEnd = cancel; this.fingerprint(); }
  async cancelSubscription(id) { this.mutations.push({ name: "cancelSubscription", id }); this.subscription.status = "canceled"; this.fingerprint(); }
  async paymentContext({ chargeId, paymentIntentId }) {
    this.calls.push({ name: "paymentContext", chargeId, paymentIntentId });
    const found = (chargeId && this.payments.get(chargeId)) || [...this.payments.values()].find((entry) => entry.paymentIntentId === paymentIntentId);
    return clone(found || null);
  }
  async getDispute(id) { return clone(this.disputes.get(id)); }
  async getFraudWarning(id) { return clone(this.warnings.get(id)); }
  async pauseCollection(subscriptionId, key) {
    this.mutations.push({ name: "pauseCollection", subscriptionId, key });
    this.subscription.collectionPaused = true;
    this.fingerprint();
    return { pausedInvoiceIds: ["in_open_retry"] };
  }
  async resumeCollection(subscriptionId, pausedInvoiceIds, key, now) {
    this.mutations.push({ name: "resumeCollection", subscriptionId, pausedInvoiceIds, key, now });
    this.subscription.collectionPaused = false;
    this.fingerprint();
  }
  async revertPrice(subscriptionId, itemId, priceId, key) {
    this.mutations.push({ name: "revertPrice", subscriptionId, itemId, priceId, key });
    this.subscription.priceId = priceId;
    this.fingerprint();
  }
  async recentEvents(types, since) { this.calls.push({ name: "recentEvents", types, since }); return clone(this.events); }
  async billingDetails() {
    return { invoices: [{ id: "in_period", number: "TF-1", status: "paid", createdAt: new Date(), total: 2900, amountPaid: 2900,
      amountDue: 0, currency: "eur", reason: "subscription_cycle", periodStart: null, periodEnd: null, creditedAmount: 0 }], paymentMethod: null };
  }
}

function setup({ sub = {}, row = {}, notifierFails = false } = {}) {
  const periodEnd = nowS() + 15 * DAY;
  const subscription = { id: SUB, customerId: CUS, status: "active", priceId: "price_promonthly", quantity: 1, currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false, paid: true, paidPriceId: "price_promonthly", paidPeriodEnd: periodEnd, livemode: false, userId: USER,
    scope: "trainers", itemId: "si_money", currentPeriodStart: nowS() - 15 * DAY, scheduleId: null, latestInvoiceId: "in_period",
    latestInvoiceStatus: "paid", pendingUpdate: false, collectionMethod: "charge_automatically", collectionPaused: false,
    fingerprint: "initial", ...sub };
  const account = { userId: USER, mode: "test", customerId: CUS, subscriptionId: SUB, status: "active", tier: "trainer_pro",
    interval: "monthly", paidUntil: new Date(subscription.paidPeriodEnd * 1000), currentPeriodEnd: new Date(subscription.currentPeriodEnd * 1000),
    cancelAtPeriodEnd: false, revision: 1, provider: clone(subscription), ...row };
  const repository = new Repository(account);
  const gateway = new Gateway(subscription);
  const mails = [];
  const notifier = { async renewalReminder(input) { if (notifierFails) throw new Error("smtp down"); mails.push(clone(input)); } };
  return { repository, gateway, mails, service: new TrainerBillingService(config(), repository, gateway, notifier) };
}
const premium = (repository) => repository.users.get(USER).professionalPremium;
const stored = (repository) => repository.accounts.get(USER);

// Una subida Pro → Growth ya pagada en este periodo, tal como la deja changePlan.
function upgradedSetup() {
  const setupResult = setup({ sub: { priceId: "price_growthmonthly", paidPriceId: null, latestInvoiceId: "in_upgrade" },
    row: { tier: "trainer_growth", change: { status: "applied", startedAt: new Date(), invoiceId: "in_upgrade", quote: {
      quoteId: "trainers-checkout-" + "a".repeat(40), kind: "immediate", expiresAt: new Date(),
      from: { tier: "trainer_pro", interval: "monthly", amount: 2900, clientLimit: 20 },
      to: { tier: "trainer_growth", interval: "monthly", amount: 4900, clientLimit: 50 },
      effectiveAt: new Date(), amountDueNow: 1000, currency: "eur", nextRenewal: { at: new Date(), amount: 4900 },
      usage: { clients: 2, limit: 20 }, subscriptionId: SUB, itemId: "si_money", priceId: "price_promonthly",
      targetPriceId: "price_growthmonthly", snapshot: "x", prorationDate: nowS() - 5 * DAY, periodEnd: nowS() + 15 * DAY } } } });
  return setupResult;
}

test("classifyInvoice: periods, same-interval upgrades and monthly → annual are recognised; anything else is unknown", () => {
  const settings = config();
  const line = (priceId, amount, proration, periodStart = 100, periodEnd = 200) =>
    ({ amount, priceId, proration, subscriptionItem: "si_1", periodStart, periodEnd });
  const invoice = (billingReason, lines) => ({ id: "in_1", subscriptionId: SUB, customerId: CUS, billingReason, amountPaid: 1, currency: "eur", lines });
  assert.equal(classifyInvoice(settings, invoice("subscription_cycle", [line("price_promonthly", 2900, false)])).kind, "period");
  const upgrade = classifyInvoice(settings, invoice("subscription_update",
    [line("price_promonthly", -2000, true), line("price_growthmonthly", 3400, true, 150, 200)]));
  assert.deepEqual([upgrade.kind, upgrade.tier, upgrade.fromTier, upgrade.fromPriceId, upgrade.periodStart],
    ["upgrade", "trainer_growth", "trainer_pro", "price_promonthly", 150]);
  assert.equal(classifyInvoice(settings, invoice("subscription_update",
    [line("price_scalemonthly", -11900, true), line("price_scaleannual", 120900, true)])).kind, "interval_change");
  // Bajadas con prorrateo (hechas a mano en el Dashboard), facturas manuales y formas raras: revisión humana.
  assert.equal(classifyInvoice(settings, invoice("subscription_update",
    [line("price_growthmonthly", -4900, true), line("price_promonthly", 2900, true)])).kind, "unknown");
  assert.equal(classifyInvoice(settings, invoice("manual", [line("price_promonthly", 2900, false)])).kind, "unknown");
  assert.equal(classifyInvoice(settings, invoice("subscription_cycle", [line("price_promonthly", 2900, false), line("price_growthmonthly", 4900, false)])).kind, "unknown");
  assert.equal(classifyInvoice(settings, invoice("subscription_cycle", [line("price_foreign", 2900, false)])).kind, "unknown");
});

test("fundingRole ties a payment to today's access only when it is certain", () => {
  const current = { subscriptionId: SUB, tier: "trainer_growth", interval: "monthly" };
  const now = nowS();
  assert.equal(fundingRole(financed("period"), current, now), "current_period");
  assert.equal(fundingRole(upgradeInvoice(), current, now), "current_upgrade");
  assert.equal(fundingRole(financed("period", { periodEnd: now - DAY }), current, now), "past");
  assert.equal(fundingRole(upgradeInvoice(), { ...current, tier: "trainer_scale" }, now), "unknown", "a later upgrade superseded it");
  assert.equal(fundingRole(financed("period", { subscriptionId: "sub_other" }), current, now), "unknown");
  assert.equal(fundingRole(financed("unknown"), current, now), "unknown");
});

test("effective access: a revoked period removes paid access, an exception grants it until a date and never fakes a payment", () => {
  const now = new Date();
  const base = { userId: USER, mode: "test", status: "active", tier: "trainer_pro", interval: "monthly", cancelAtPeriodEnd: false,
    revision: 1, paidUntil: new Date(now.getTime() + 10 * DAY * 1000) };
  const revoke = { id: "adj-1", kind: "revoke_period", from: new Date(now.getTime() - DAY * 1000), until: base.paidUntil,
    liftedAt: null, reason: "x", source: "dispute_lost" };
  assert.deepEqual([effectiveAccess(base, now).entitled, effectiveAccess(base, now).basis], [true, "payment"]);
  const revoked = effectiveAccess({ ...base, adjustments: [revoke] }, now);
  assert.deepEqual([revoked.entitled, revoked.expiresAt, revoked.revokedUntil.getTime()], [false, null, base.paidUntil.getTime()]);
  assert.equal(effectiveAccess({ ...base, adjustments: [{ ...revoke, liftedAt: now }] }, now).entitled, true, "lifted revocations stop applying");
  const until = new Date(now.getTime() + 3 * DAY * 1000);
  const grant = { id: "adj-2", kind: "grant", from: now, until, tier: "trainer_scale", interval: "monthly", liftedAt: null, reason: "x", source: "admin" };
  const exception = effectiveAccess({ ...base, status: "canceled", paidUntil: null, adjustments: [grant] }, now);
  assert.deepEqual([exception.entitled, exception.tier, exception.basis, exception.expiresAt.getTime()], [true, "trainer_scale", "exception", until.getTime()]);
  const lower = effectiveAccess({ ...base, tier: "trainer_growth", adjustments: [{ ...grant, tier: "trainer_pro" }] }, now);
  assert.deepEqual([lower.tier, lower.basis, lower.expiresAt.getTime()], ["trainer_growth", "payment", base.paidUntil.getTime()], "a lower exception never downgrades a paid plan");
  const expired = effectiveAccess({ ...base, status: "canceled", paidUntil: null, adjustments: [{ ...grant, until: new Date(now.getTime() - 1000) }] }, now);
  assert.equal(expired.entitled, false);
  assert.equal(projection({ ...base, adjustments: [revoke] }, now).entitled, false);
});

test("a full refund of the current period never ends access by itself: it opens one high-priority case", async () => {
  const { service, gateway, repository } = setup();
  gateway.payments.set("ch_period", payment("ch_period", financed("period"), [refund("re_1", 2900)]));
  const deliver = (id, type, detail) => service.event(event(id, type, detail, type === "charge.refunded" ? CUS : null));
  // Orden cambiado y duplicados: refund.updated llega antes que charge.refunded y ambos se repiten.
  await deliver("evt_ru", "refund.updated", { refundId: "re_1", chargeId: "ch_period" });
  await deliver("evt_cr", "charge.refunded", { chargeId: "ch_period", paymentIntentId: "pi_ch_period", fullyRefunded: true });
  await deliver("evt_cr", "charge.refunded", { chargeId: "ch_period", paymentIntentId: "pi_ch_period", fullyRefunded: true });
  assert.equal(gateway.mutations.length, 0, "no cancellation, no pause, no Stripe change");
  assert.equal(premium(repository).entitled, true);
  assert.equal(stored(repository).status, "active");
  assert.equal(repository.cases.size, 1);
  const entry = repository.cases.get("refund:ch_period");
  assert.deepEqual([entry.status, entry.priority, entry.suggestion, entry.role, entry.amount, entry.fullyRefunded],
    ["open", "high", "decide_end_or_keep", "current_period", 2900, true]);
});

test("refunding a plan upgrade suggests reverting it; reverting keeps the paid base period and charges nothing", async () => {
  const { service, gateway, repository } = upgradedSetup();
  gateway.payments.set("ch_up", payment("ch_up", upgradeInvoice(), [refund("re_up", 1000)]));
  await service.event(event("evt_up", "charge.refunded", { chargeId: "ch_up", paymentIntentId: "pi_ch_up", fullyRefunded: true }, CUS));
  assert.equal(stored(repository).tier, "trainer_growth", "the refund alone changes nothing");
  const entry = repository.cases.get("refund:ch_up");
  assert.deepEqual([entry.role, entry.suggestion], ["current_upgrade", "revert_upgrade"]);
  const paidUntil = stored(repository).paidUntil.getTime();
  const view = await service.intervene(USER, { action: "revert_upgrade", reason: "Devuelta la subida a petición del cliente",
    caseId: "refund:ch_up", resolveCase: true }, ADMIN);
  assert.deepEqual(gateway.mutated("revertPrice").map((entry) => entry.priceId), ["price_promonthly"]);
  assert.equal(gateway.mutated("cancelSubscription").length, 0);
  assert.equal(stored(repository).tier, "trainer_pro");
  assert.equal(stored(repository).paidUntil.getTime(), paidUntil, "the base period already paid is respected");
  assert.equal(stored(repository).change.status, "reverted");
  assert.deepEqual([premium(repository).entitled, premium(repository).tier], [true, "trainer_pro"]);
  assert.equal(repository.cases.get("refund:ch_up").status, "resolved");
  const [intervention] = repository.interventions;
  assert.deepEqual([intervention.status, intervention.by.email, intervention.before.tier, intervention.after.tier],
    ["applied", "admin@example.test", "trainer_growth", "trainer_pro"]);
  assert.equal(view.account.tier, "trainer_pro");
});

test("partial, old and failed refunds are recorded with the right priority; a new movement reopens a resolved case", async () => {
  const { service, gateway, repository } = setup();
  gateway.payments.set("ch_partial", payment("ch_partial", financed("period"), [refund("re_p", 500)]));
  gateway.payments.set("ch_old", payment("ch_old", financed("period", { invoiceId: "in_old", periodStart: nowS() - 60 * DAY, periodEnd: nowS() - 30 * DAY }),
    [refund("re_o", 2900)]));
  await service.event(event("evt_p", "charge.refunded", { chargeId: "ch_partial" }, CUS));
  await service.event(event("evt_o", "charge.refunded", { chargeId: "ch_old" }, CUS));
  assert.deepEqual([repository.cases.get("refund:ch_partial").suggestion, repository.cases.get("refund:ch_partial").priority], ["keep_access", "normal"]);
  assert.deepEqual([repository.cases.get("refund:ch_old").role, repository.cases.get("refund:ch_old").suggestion], ["past", "keep_access"]);
  await service.intervene(USER, { action: "resolve_case", reason: "Compensación por incidencia", caseId: "refund:ch_partial" }, ADMIN);
  assert.equal(repository.cases.get("refund:ch_partial").status, "resolved");
  gateway.payments.set("ch_partial", payment("ch_partial", financed("period"), [refund("re_p", 500, "failed")]));
  await service.event(event("evt_pf", "refund.failed", { refundId: "re_p", chargeId: "ch_partial" }));
  const reopened = repository.cases.get("refund:ch_partial");
  assert.deepEqual([reopened.status, reopened.priority, reopened.suggestion], ["open", "high", "check_failed_refund"]);
  assert.equal(reopened.notes.length, 1);
  assert.equal(premium(repository).entitled, true);
  const details = await service.billingDetails(USER);
  assert.equal(details.invoices[0].refundedAmount, 0, "a failed refund returns no money");
});

test("an open dispute pauses future charges once, keeps access and blocks new charges from plan changes", async () => {
  const { service, gateway, repository } = setup();
  const dueBy = new Date(Date.now() + 10 * DAY * 1000);
  gateway.payments.set("ch_disputed", payment("ch_disputed", financed("period")));
  gateway.disputes.set("dp_1", { id: "dp_1", status: "needs_response", amount: 2900, currency: "eur", reason: "fraudulent",
    chargeId: "ch_disputed", paymentIntentId: "pi_ch_disputed", dueBy, createdAt: new Date() });
  await service.event(event("evt_d1", "charge.dispute.created", { disputeId: "dp_1", chargeId: "ch_disputed" }));
  await service.event(event("evt_d2", "charge.dispute.updated", { disputeId: "dp_1", chargeId: "ch_disputed" }));
  assert.equal(gateway.mutated("pauseCollection").length, 1);
  assert.equal(gateway.mutated("pauseCollection")[0].key, "trainers-dispute-dp_1-pause");
  const row = stored(repository);
  assert.deepEqual([row.hold.kind, row.hold.caseIds, row.hold.pausedInvoiceIds], ["dispute", ["dispute:dp_1"], ["in_open_retry"]]);
  assert.equal(premium(repository).entitled, true, "a dispute never drops the trainer to Free by itself");
  const entry = repository.cases.get("dispute:dp_1");
  assert.deepEqual([entry.priority, entry.suggestion, entry.dueBy.getTime(), entry.effects], ["high", "respond_dispute", dueBy.getTime(), ["collection_paused"]]);
  await assert.rejects(service.previewChange(USER, "trainer_growth", "monthly"), code("COLLECTION_PAUSED"));
  const metadata = billingMetadata(config(), stored(repository), "stripe");
  assert.equal(metadata.billing.actions.canChange, false);
  assert.ok(metadata.billing.hold);
  assert.equal("review" in metadata.billing, false, "internal case data is never sent to the trainer");
});

test("a lost dispute withdraws only the rights its payment financed", async (t) => {
  await t.test("current period: paid access ends for that period, data and subscription stay, charges stay paused", async () => {
    const { service, gateway, repository } = setup();
    gateway.payments.set("ch_d", payment("ch_d", financed("period")));
    gateway.disputes.set("dp_l", { id: "dp_l", status: "needs_response", amount: 2900, currency: "eur", reason: "fraudulent",
      chargeId: "ch_d", paymentIntentId: "pi_ch_d", dueBy: null, createdAt: new Date() });
    await service.event(event("evt_open", "charge.dispute.created", { disputeId: "dp_l" }));
    gateway.disputes.get("dp_l").status = "lost";
    await service.event(event("evt_lost", "charge.dispute.closed", { disputeId: "dp_l" }));
    await service.event(event("evt_lost_again", "charge.dispute.updated", { disputeId: "dp_l" }));
    assert.equal(premium(repository).entitled, false);
    assert.equal(stored(repository).adjustments.filter((entry) => entry.kind === "revoke_period").length, 1, "applied once");
    assert.equal(gateway.mutated("cancelSubscription").length, 0);
    assert.ok(stored(repository).hold, "future charges stay paused until a person decides");
    const entry = repository.cases.get("dispute:dp_l");
    assert.deepEqual([entry.effects, entry.suggestion, entry.status], [["collection_paused", "rights_withdrawn:period"], "decide_collection", "open"]);
    // Una persona puede devolver el periodo (p. ej. si el banco revoca su decisión): queda registrado.
    const adjustmentId = stored(repository).adjustments[0].id;
    await service.intervene(USER, { action: "restore_period_access", reason: "El banco revocó la decisión", adjustmentId }, ADMIN);
    assert.equal(premium(repository).entitled, true);
  });
  await t.test("current upgrade: back to the previous plan, base period kept", async () => {
    const { service, gateway, repository } = upgradedSetup();
    gateway.payments.set("ch_u", payment("ch_u", upgradeInvoice()));
    gateway.disputes.set("dp_u", { id: "dp_u", status: "lost", amount: 1000, currency: "eur", reason: "general",
      chargeId: "ch_u", paymentIntentId: "pi_ch_u", dueBy: null, createdAt: new Date() });
    await service.event(event("evt_u", "charge.dispute.closed", { disputeId: "dp_u" }));
    assert.deepEqual(gateway.mutated("revertPrice").map((entry) => [entry.priceId, entry.key]), [["price_promonthly", "trainers-dispute-dp_u-revert"]]);
    assert.deepEqual([premium(repository).entitled, premium(repository).tier], [true, "trainer_pro"]);
  });
  await t.test("an old period or an unknown payment never touches today's access", async () => {
    const { service, gateway, repository } = setup();
    gateway.payments.set("ch_old", payment("ch_old", financed("period", { periodStart: nowS() - 60 * DAY, periodEnd: nowS() - 30 * DAY })));
    gateway.payments.set("ch_unknown", payment("ch_unknown", financed("unknown")));
    for (const [id, charge] of [["dp_old", "ch_old"], ["dp_unk", "ch_unknown"]]) {
      gateway.disputes.set(id, { id, status: "lost", amount: 2900, currency: "eur", reason: "general", chargeId: charge,
        paymentIntentId: `pi_${charge}`, dueBy: null, createdAt: new Date() });
      await service.event(event(`evt_${id}`, "charge.dispute.closed", { disputeId: id }));
    }
    assert.equal(premium(repository).entitled, true);
    assert.deepEqual(repository.cases.get("dispute:dp_old").effects, ["rights_past"]);
    assert.deepEqual([repository.cases.get("dispute:dp_unk").effects, repository.cases.get("dispute:dp_unk").suggestion],
      [["rights_unknown"], "manual_review"]);
  });
});

test("a won dispute keeps access and asks a person whether to resume charges; resuming re-enables the paused retries", async () => {
  const { service, gateway, repository } = setup();
  gateway.payments.set("ch_w", payment("ch_w", financed("period")));
  gateway.disputes.set("dp_w", { id: "dp_w", status: "under_review", amount: 2900, currency: "eur", reason: "product_not_received",
    chargeId: "ch_w", paymentIntentId: "pi_ch_w", dueBy: null, createdAt: new Date() });
  await service.event(event("evt_w1", "charge.dispute.created", { disputeId: "dp_w" }));
  await service.intervene(USER, { action: "resolve_case", reason: "Pruebas enviadas; esperar decisión", caseId: "dispute:dp_w" }, ADMIN);
  gateway.disputes.get("dp_w").status = "won";
  await service.event(event("evt_w2", "charge.dispute.closed", { disputeId: "dp_w" }));
  const entry = repository.cases.get("dispute:dp_w");
  assert.deepEqual([entry.status, entry.suggestion, entry.priority], ["open", "decide_collection", "normal"], "closing reopens the case");
  assert.equal(premium(repository).entitled, true);
  await service.intervene(USER, { action: "resume_collection", reason: "Disputa ganada; el cliente sigue", caseId: "dispute:dp_w", resolveCase: true }, ADMIN);
  assert.deepEqual(gateway.mutated("resumeCollection")[0].pausedInvoiceIds, ["in_open_retry"]);
  assert.equal(stored(repository).hold, null);
  assert.equal(repository.cases.get("dispute:dp_w").status, "resolved");
});

test("an early fraud warning opens a high-priority case and changes nothing else", async () => {
  const { service, gateway, repository } = setup();
  gateway.payments.set("ch_f", payment("ch_f", financed("period")));
  gateway.warnings.set("issfr_1", { id: "issfr_1", chargeId: "ch_f", paymentIntentId: "pi_ch_f", fraudType: "unauthorized_use_of_card",
    actionable: true, createdAt: new Date() });
  await service.event(event("evt_f", "radar.early_fraud_warning.created", { warningId: "issfr_1", chargeId: "ch_f" }));
  const entry = repository.cases.get("efw:issfr_1");
  assert.deepEqual([entry.kind, entry.priority, entry.suggestion], ["early_fraud_warning", "high", "review_fraud_warning"]);
  assert.equal(gateway.mutations.length, 0);
  assert.equal(premium(repository).entitled, true);
});

test("interventions require a reason, record author and outcome, and fail closed", async () => {
  const { service, gateway, repository } = setup();
  await assert.rejects(service.intervene(USER, { action: "end_service_now", reason: "" }, ADMIN), code("REASON_REQUIRED"));
  await assert.rejects(service.intervene(USER, { action: "delete_everything", reason: "motivo" }, ADMIN), code("INVALID_ACTION"));
  await assert.rejects(service.intervene(USER, { action: "grant_access", reason: "motivo", tier: "trainer_pro", until: "2001-01-01" }, ADMIN),
    code("INVALID_UNTIL"));
  assert.equal(repository.interventions.length, 0, "invalid requests are rejected before anything is recorded");
  // Otra operación en curso: la intervención queda registrada como fallida.
  repository.leases.add(USER);
  await assert.rejects(service.intervene(USER, { action: "cancel_renewal", reason: "Petición por email" }, ADMIN), code("BILLING_BUSY"));
  repository.leases.delete(USER);
  assert.deepEqual([repository.interventions[0].status, repository.interventions[0].error], ["failed", "BILLING_BUSY"]);
  await service.intervene(USER, { action: "cancel_renewal", reason: "Petición por email" }, ADMIN);
  assert.equal(gateway.subscription.cancelAtPeriodEnd, true);
  await service.intervene(USER, { action: "end_service_now", reason: "Devolución anual en 7 días" }, ADMIN);
  assert.equal(gateway.mutated("cancelSubscription").length, 1);
  assert.equal(premium(repository).entitled, false);
  const until = new Date(Date.now() + 5 * DAY * 1000).toISOString();
  await service.intervene(USER, { action: "grant_access", reason: "Cortesía mientras migra", tier: "trainer_pro", until }, ADMIN);
  assert.deepEqual([premium(repository).entitled, premium(repository).expiresAt.toISOString()], [true, until]);
  const grant = stored(repository).adjustments.find((entry) => entry.kind === "grant");
  await service.intervene(USER, { action: "end_grant", reason: "Fin de la cortesía", adjustmentId: grant.id }, ADMIN);
  assert.equal(premium(repository).entitled, false);
  assert.deepEqual(repository.interventions.map((entry) => [entry.action, entry.status]), [
    ["cancel_renewal", "failed"], ["cancel_renewal", "applied"], ["end_service_now", "applied"], ["grant_access", "applied"], ["end_grant", "applied"]]);
  assert.ok(repository.interventions.every((entry) => entry.by.id === "admin-1"));
});

test("pausing charges by hand blocks plan changes; the Stripe pause state is mirrored both ways", async () => {
  const { service, gateway, repository } = setup();
  await service.intervene(USER, { action: "pause_collection", reason: "Revisión de un cobro dudoso" }, ADMIN);
  assert.equal(stored(repository).hold.kind, "admin");
  await assert.rejects(service.previewChange(USER, "trainer_growth", "monthly"), code("COLLECTION_PAUSED"));
  await assert.rejects(service.intervene(USER, { action: "pause_collection", reason: "Otra vez" }, ADMIN), code("ALREADY_PAUSED"));
  // Reanudado desde el Dashboard: TrainFit lo refleja en la siguiente lectura.
  gateway.subscription.collectionPaused = false;
  gateway.fingerprint();
  await service.sync(USER);
  assert.equal(stored(repository).hold, null);
  // Pausado desde el Dashboard sin pasar por TrainFit: también se refleja.
  gateway.subscription.collectionPaused = true;
  gateway.fingerprint();
  await service.sync(USER);
  assert.equal(stored(repository).hold.kind, "admin");
});

test("annual renewal reminders go out at 30 and 7 days, once each, only for annual plans that will renew", async (t) => {
  const renewalAt = nowS() + 60 * DAY;
  const annual = (overrides = {}) => setup({ sub: { priceId: "price_proannual", paidPriceId: "price_proannual",
    currentPeriodEnd: renewalAt, paidPeriodEnd: renewalAt, ...overrides }, row: { interval: "annual" } });
  await t.test("30 days, repeated rounds, then 7 days", async () => {
    const { service, gateway, mails } = annual();
    gateway.upcomingRenewal = async (sub) => ({ at: sub.currentPeriodEnd, amount: 29700, priceId: sub.priceId, subtotal: 29700 });
    gateway.subscription.billingNow = renewalAt - 40 * DAY;
    await service.reconcile();
    assert.equal(mails.length, 0, "not yet");
    gateway.subscription.billingNow = renewalAt - 25 * DAY;
    await service.reconcile();
    await service.reconcile();
    assert.deepEqual(mails.map((mail) => mail.stage), [30]);
    assert.deepEqual([mails[0].email, mails[0].amount, mails[0].supportEmail, mails[0].manageUrl],
      ["trainer@example.test", 29700, "facturacion@example.test", "http://localhost:8100/tabs/subscription"]);
    gateway.subscription.billingNow = renewalAt - 5 * DAY;
    await service.reconcile();
    await service.reconcile();
    assert.deepEqual(mails.map((mail) => mail.stage), [30, 7]);
  });
  await t.test("monthly plans and cancelled renewals get nothing", async () => {
    const monthly = setup();
    monthly.gateway.subscription.billingNow = monthly.gateway.subscription.currentPeriodEnd - 5 * DAY;
    await monthly.service.reconcile();
    assert.equal(monthly.mails.length, 0);
    const cancelling = annual({ cancelAtPeriodEnd: true });
    cancelling.gateway.subscription.billingNow = renewalAt - 5 * DAY;
    await cancelling.service.reconcile();
    assert.equal(cancelling.mails.length, 0);
  });
  await t.test("a failed send is retried in the next round instead of being lost or duplicated", async () => {
    const { service, gateway, repository } = annual();
    let fail = true;
    const sent = [];
    service.notifier.renewalReminder = async (input) => { if (fail) throw new Error("smtp down"); sent.push(input.stage); };
    gateway.subscription.billingNow = renewalAt - 20 * DAY;
    await service.reconcile();
    assert.equal(stored(repository).reminders, null);
    fail = false;
    await service.reconcile();
    await service.reconcile();
    assert.deepEqual(sent, [30]);
  });
});

test("backfill recovers money events missed by the webhook and never processes one twice", async () => {
  const { service, gateway, repository } = setup();
  gateway.payments.set("ch_missed", payment("ch_missed", financed("period"), [refund("re_m", 2900)]));
  gateway.events = [event("evt_missed", "charge.refunded", { chargeId: "ch_missed" }, CUS)];
  const start = Date.now();
  assert.equal(await service.backfillMoneyEvents(start), 1);
  assert.ok(repository.cases.has("refund:ch_missed"));
  assert.equal(await service.backfillMoneyEvents(start + 60000), 0, "throttled to one pass every 10 minutes");
  assert.equal(await service.backfillMoneyEvents(start + 11 * 60000), 1);
  assert.equal(repository.events.get("evt_missed").status, "processed");
  assert.equal(gateway.calls.filter((call) => call.name === "paymentContext").length, 1, "an already processed event is not re-read");
  const [first, second] = gateway.calls.filter((call) => call.name === "recentEvents");
  assert.ok(second.since > first.since && second.since < Math.floor(start / 1000) + 11 * 60, "later passes only look back from the previous one");
});

test("the terms accepted in Checkout are recorded with the session", async () => {
  const { service, gateway, repository } = setup();
  gateway.sessions.set("cs_test_terms", { id: "cs_test_terms", customerId: CUS, userId: USER, scope: "trainers", livemode: false,
    status: "complete", url: null, subscriptionId: SUB, termsAccepted: true });
  gateway.sessions.set("cs_test_foreign", { id: "cs_test_foreign", customerId: CUS, userId: "someone-else", scope: "trainers",
    livemode: false, status: "complete", url: null, subscriptionId: SUB, termsAccepted: true });
  await service.event(event("evt_foreign", "checkout.session.completed", { sessionId: "cs_test_foreign" }, CUS));
  assert.equal(stored(repository).termsAcceptance, undefined, "a session that is not the trainer's never counts");
  await service.event(event("evt_terms", "checkout.session.completed", { sessionId: "cs_test_terms" }, CUS));
  assert.equal(stored(repository).termsAcceptance.sessionId, "cs_test_terms");
});

test("an annual renewal within 30 days is announced in the app too; support contact comes from configuration", () => {
  const at = new Date(Date.now() + 12 * DAY * 1000);
  const account = { userId: USER, mode: "test", customerId: CUS, subscriptionId: SUB, status: "active", tier: "trainer_pro",
    interval: "annual", paidUntil: at, currentPeriodEnd: at, cancelAtPeriodEnd: false, revision: 1,
    renewal: { at, amount: 29700, fingerprint: "x", priceId: "price_proannual", subtotal: 29700 } };
  const metadata = billingMetadata(config(), account, "stripe").billing;
  assert.deepEqual([metadata.renewalNotice.daysLeft, metadata.renewalNotice.amount], [12, 29700]);
  assert.deepEqual(metadata.support, { email: "facturacion@example.test", termsUrl: null });
  assert.equal(billingMetadata(config(), { ...account, cancelAtPeriodEnd: true }, "stripe").billing.renewalNotice, null);
  assert.equal(billingMetadata(config(), { ...account, interval: "monthly" }, "stripe").billing.renewalNotice, null);
});
