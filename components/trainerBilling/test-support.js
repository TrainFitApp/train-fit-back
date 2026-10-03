// Utilidades compartidas por los tests de la facturación de Trainers: configuración del sandbox,
// precios del catálogo tal como los crea `npm run stripe:catalog`, y dobles en memoria del
// repositorio y de Stripe (la interfaz Gateway). Sin red, base de datos ni credenciales reales.
// No acaba en .test.js: `node --test` no lo ejecuta por sí solo.
const assert = require("node:assert/strict");
const { BillingError } = require("../../.build/trainer-billing/types");
const { CATALOG, catalogAmount, catalogPrices, lookupKey, recurringAmount, sameState } = require("../../.build/trainer-billing/catalog");
const { loadConfig } = require("../../.build/trainer-billing/config");
const { TrainerBillingService } = require("../../.build/trainer-billing/service");

const USER_ID = "trainer-one";
const CUSTOMER_ID = "cus_trainerone";
const DAY = 86400;
const copy = (value) => structuredClone(value);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const errorCode = (code) => (error) => error instanceof BillingError && error.code === code;
// Las credenciales de prueba se montan por partes para que ningún escáner las tome por reales.
const fake = (...parts) => parts.join("_");

function sandboxEnv(overrides = {}) {
  return { STRIPE_KEY: fake("rk", "test", "unit"), STRIPE_WEBHOOK_SECRET: fake("whsec", "unit"),
    STRIPE_RETURN_URL: "http://localhost:8100", ...overrides };
}
const sandboxConfig = (overrides) => loadConfig(sandboxEnv(overrides));

// ---------- Precios y estados ----------

const priceId = (kind, tier, interval) => `price_${tier}_${kind}_${interval}`;
function priceRef(kind, tier, interval) {
  return { id: priceId(kind, tier, interval), kind, tier, interval, amount: catalogAmount(kind, tier, interval) };
}
// Precio de Stripe con los metadatos y la lookup key que pone el script de catálogo.
function stripePrice(kind, tier, interval, overrides = {}) {
  return { id: priceId(kind, tier, interval), object: "price", livemode: false, active: true, type: "recurring", currency: "eur",
    unit_amount: catalogAmount(kind, tier, interval), billing_scheme: "per_unit", tax_behavior: "exclusive",
    lookup_key: lookupKey(kind, tier, interval),
    recurring: { interval: interval === "annual" ? "year" : "month", interval_count: 1, usage_type: "licensed" },
    metadata: { trainfit_catalog: "trainers", trainfit_kind: kind, trainfit_tier: tier, trainfit_interval: interval }, ...overrides };
}
const catalogStripePrices = () => catalogPrices().map((entry) => stripePrice(entry.kind, entry.tier, entry.interval));
const state = (tier, interval = "monthly", extraSeats = 0) => ({ tier, interval, extraSeats });
const encode = (value) => `${value.tier}:${value.interval}:${value.extraSeats}`;

// Elementos de la suscripción (vista del gateway) para un estado: cuota (salvo Free) y plazas.
function itemsFor(value, ids = {}) {
  const items = [];
  if (value.tier !== "free") items.push({ id: ids.base || "si_base", price: priceRef("base", value.tier, value.interval), quantity: 1 });
  if (value.extraSeats > 0) items.push({ id: ids.seat || "si_seat", price: priceRef("seat", value.tier, value.interval), quantity: value.extraSeats });
  return items;
}
const phaseItems = (value) => itemsFor(value).map((item) => ({ price: item.price.id, quantity: item.quantity }));

function subscription(value, overrides = {}) {
  const periodEnd = nowSeconds() + 30 * DAY;
  return { id: "sub_trainers", customerId: CUSTOMER_ID, status: "active", state: value, items: itemsFor(value),
    currentPeriodEnd: periodEnd, currentPeriodStart: periodEnd - 30 * DAY, cancelAtPeriodEnd: false,
    paid: true, paidPeriodEnd: periodEnd, livemode: false, userId: USER_ID, scope: "trainers", scheduleId: null,
    latestInvoiceId: "in_period", latestInvoiceStatus: "paid", pendingUpdate: false, collectionMethod: "charge_automatically",
    ...overrides };
}
function account(overrides = {}) {
  return { userId: USER_ID, mode: "test", customerId: CUSTOMER_ID, status: "none", cancelAtPeriodEnd: false, revision: 0, ...overrides };
}
function session(overrides = {}) {
  return { id: "cs_test_owned", customerId: CUSTOMER_ID, subscriptionId: null, status: "open", url: "https://checkout.stripe.com/c/pay/owned",
    userId: USER_ID, attempt: "attempt-original", target: "starter:monthly:0", scope: "trainers", livemode: false, ...overrides };
}
function event(overrides = {}) {
  return { eventId: "evt_one", type: "invoice.paid", customerId: CUSTOMER_ID, mode: "test", status: "pending", attempts: 0, ...overrides };
}

// ---------- Repositorio en memoria (mismo contrato de lease que Mongo) ----------

class MemoryRepository {
  constructor(initialAccount, seats = { occupied: 0, reserved: 0 }) {
    this.accounts = new Map(initialAccount ? [[initialAccount.userId, copy(initialAccount)]] : []);
    this.users = new Map([[USER_ID, { id: USER_ID, email: "trainer@example.test" }]]);
    this.seats = seats;
    this.events = new Map();
    this.cases = new Map();
    this.interventions = [];
    this.leases = new Set();
    this.projections = [];
    this.projectFailures = 0;
    // Predicado: la siguiente escritura que lo cumpla falla (fallo local tras una llamada a Stripe).
    this.failSaveWhen = null;
  }
  async get(userId) { return copy(this.accounts.get(userId) || null); }
  async findCustomer(customerId) { return copy([...this.accounts.values()].find((row) => row.customerId === customerId) || null); }
  async getUser(userId) { return copy(this.users.get(userId) || null); }
  async seatUsage() { return copy(this.seats); }
  async withLock(userId, action) {
    if (this.leases.has(userId)) throw new BillingError("BILLING_BUSY", "Fake lease is held");
    this.leases.add(userId);
    const row = copy(this.accounts.get(userId) || account({ userId, customerId: undefined }));
    this.accounts.set(userId, copy(row));
    const save = async () => {
      assert.ok(this.leases.has(userId), "writes require the lease");
      if (this.failSaveWhen?.(row)) { this.failSaveWhen = null; throw new Error("Simulated local save failure"); }
      row.revision += 1;
      this.accounts.set(userId, copy(row));
    };
    try { return await action(row, save); }
    finally { this.leases.delete(userId); }
  }
  async project(row, value) {
    if (this.projectFailures > 0) { this.projectFailures -= 1; throw new Error("Simulated projection storage failure"); }
    this.projections.push({ userId: row.userId, value: copy(value) });
  }
  get lastProjection() { return this.projections.at(-1)?.value || null; }
  async saveEvent(record) {
    const stored = this.events.get(record.eventId) || copy(record);
    stored.attempts += 1;
    this.events.set(stored.eventId, stored);
    return copy(stored);
  }
  async completeEvent(id) { this.events.get(id).status = "processed"; }
  async failEvent(id) { const stored = this.events.get(id); if (stored.status !== "processed") stored.status = "failed"; }
  async pendingEvents(limit) { return copy([...this.events.values()].filter((row) => row.status !== "processed").slice(0, limit)); }
  async accountsForReconciliation(limit) { return copy([...this.accounts.values()].filter((row) => row.customerId).slice(0, limit)); }
  async getCase(caseId) { return copy(this.cases.get(caseId) || null); }
  async saveCase(entry) { this.cases.set(entry.caseId, copy(entry)); }
  async listCases(filter) {
    return copy([...this.cases.values()].filter((entry) => (!filter.userId || entry.userId === filter.userId) &&
      (!filter.status || entry.status === filter.status)).slice(0, filter.limit));
  }
  async saveIntervention(entry) { this.interventions.push(copy(entry)); }
  async updateIntervention(id, patch) { Object.assign(this.interventions.find((entry) => entry.interventionId === id), copy(patch)); }
  async listInterventions(userId, limit) { return copy(this.interventions.filter((entry) => entry.userId === userId).slice(0, limit)); }
}

// ---------- Stripe en memoria (interfaz Gateway) ----------
// Reproduce lo que importa al servicio: las subidas quedan pendientes hasta pagar su factura, las
// plazas mensuales se aplican al momento, los cambios programados esperan a la renovación y la
// prueba de pago es la última factura pagada sin actualización pendiente.

class FakeStripe {
  constructor() {
    this.subs = [];
    this.sessions = [];
    this.invoices = new Map();
    this.schedules = new Map();
    this.calls = [];
    this.failures = new Map();
    this.lost = new Set();
    this.counter = 0;
    this.catalogMissing = false;
  }
  call(name, args) {
    this.calls.push({ name, args: copy(args) });
    const failure = this.failures.get(name);
    if (failure) { this.failures.delete(name); throw failure; }
  }
  // La próxima llamada a `name` falla antes de llegar a Stripe.
  failNext(name, error = new Error(`Simulated ${name} failure`)) { this.failures.set(name, error); }
  // La próxima llamada a `name` se aplica en Stripe pero su respuesta se pierde.
  loseNextResponse(name) { this.lost.add(name); }
  answered(name) { if (this.lost.delete(name)) throw new Error(`Simulated lost ${name} response`); }
  named(name) { return this.calls.filter((entry) => entry.name === name); }
  sub(id = "sub_trainers") { return this.subs.find((entry) => entry.id === id); }
  setState(sub, value) { sub.state = copy(value); sub.items = itemsFor(value); }
  next(prefix) { this.counter += 1; return `${prefix}_${this.counter}`; }

  async createCustomer(user, key) { this.call("createCustomer", { user, key }); return CUSTOMER_ID; }
  async validateState(value) {
    this.call("validateState", { value });
    if (this.catalogMissing) throw new BillingError("PRICE_CATALOG_REQUIRED", "Falta un precio del catálogo en Stripe.", 503);
  }
  async listSubscriptions() {
    return copy(this.subs.map((sub) => ({ ...sub, paid: sub.latestInvoiceStatus === "paid" && !sub.pendingUpdate })));
  }
  async listSessions() { return copy(this.sessions); }
  async getSession(id) {
    const found = this.sessions.find((entry) => entry.id === id);
    if (!found) throw new BillingError("SESSION_NOT_OWNED", "Unknown session", 403);
    return copy(found);
  }
  async createCheckout(user, row, target, key) {
    this.call("createCheckout", { userId: user.id, target, key });
    const existing = this.sessions.find((entry) => entry.attempt === key);
    if (existing) return copy(existing);
    this.counter += 1;
    const created = session({ id: `cs_test_session${this.counter}`, attempt: key, target: encode(target),
      url: `https://checkout.stripe.com/c/pay/${key}` });
    this.sessions.push(created);
    return copy(created);
  }
  // Checkout completado y pagado: crea la suscripción con los elementos del estado.
  completeCheckout(sessionId, overrides = {}) {
    const found = this.sessions.find((entry) => entry.id === sessionId);
    const [tier, interval, extras] = found.target.split(":");
    const sub = subscription(state(tier, interval, Number(extras)), overrides);
    found.status = "complete";
    found.subscriptionId = sub.id;
    this.subs.push(sub);
    return sub;
  }
  async createPortal() { this.call("createPortal", {}); return "https://billing.stripe.com/p/session/test"; }
  async cancelSubscription(id) { this.call("cancelSubscription", { id }); const sub = this.sub(id); if (sub) sub.status = "canceled"; }
  async expireSession(id) { this.call("expireSession", { id }); const found = this.sessions.find((entry) => entry.id === id); if (found) found.status = "expired"; }
  // Importes deterministas: la mitad del periodo queda por usar.
  async previewChange(sub, target, kind, prorationDate) {
    this.call("previewChange", { subId: sub.id, target, kind, prorationDate });
    const from = recurringAmount(sub.state);
    const to = recurringAmount(target);
    if (kind === "scheduled") return { amountDueNow: 0, renewalAmount: to, renewalAt: sub.currentPeriodEnd, creditBalance: 0 };
    const intervalChanges = sub.state.interval !== target.interval;
    return { amountDueNow: intervalChanges ? to - Math.round(from / 2) : Math.round((to - from) / 2),
      renewalAmount: to, renewalAt: intervalChanges ? prorationDate + 365 * DAY : sub.currentPeriodEnd, creditBalance: 0, lines: [],
      renewalExcludesTax: intervalChanges };
  }
  async changeItems(sub, target) {
    return { updates: [{ id: "si_base", price: priceId("base", target.tier === "free" ? "starter" : target.tier, target.interval), quantity: 1 }],
      fromItems: phaseItems(sub.state), targetItems: phaseItems(target) };
  }
  async applyUpgrade(quote, key) {
    this.call("applyUpgrade", { quoteId: quote.quoteId, key, to: quote.to });
    const existing = [...this.invoices.entries()].find(([, invoice]) => invoice.key === key);
    if (existing) return { invoiceId: existing[0] };
    const sub = this.sub(quote.subscriptionId);
    const invoiceId = this.next("in_change");
    const intervalChanges = sub.state.interval !== quote.to.interval;
    this.invoices.set(invoiceId, { key, status: "open", subscriptionId: sub.id, target: { tier: quote.to.tier, interval: quote.to.interval,
      extraSeats: quote.to.extraSeats }, periodEnd: intervalChanges ? quote.prorationDate + 365 * DAY : sub.currentPeriodEnd });
    sub.pendingUpdate = true;
    sub.latestInvoiceId = invoiceId;
    sub.latestInvoiceStatus = "open";
    this.answered("applyUpgrade");
    return { invoiceId };
  }
  // El entrenador paga la factura de la subida: Stripe aplica la actualización pendiente.
  pay(invoiceId) {
    const invoice = this.invoices.get(invoiceId);
    const sub = this.sub(invoice.subscriptionId);
    invoice.status = "paid";
    this.setState(sub, invoice.target);
    sub.currentPeriodEnd = invoice.periodEnd;
    sub.paidPeriodEnd = invoice.periodEnd;
    sub.pendingUpdate = false;
    sub.latestInvoiceStatus = "paid";
  }
  async scheduleChange(quote, key) {
    this.call("scheduleChange", { quoteId: quote.quoteId, key, to: quote.to });
    const existing = [...this.schedules.entries()].find(([, schedule]) => schedule.key === key);
    if (existing) return { scheduleId: existing[0] };
    const scheduleId = this.next("sub_sched");
    this.schedules.set(scheduleId, { key, target: { tier: quote.to.tier, interval: quote.to.interval, extraSeats: quote.to.extraSeats } });
    this.sub(quote.subscriptionId).scheduleId = scheduleId;
    this.answered("scheduleChange");
    return { scheduleId };
  }
  // Fin del periodo: se aplica el calendario (si lo hay) y se cobra la renovación.
  renew(paid = true) {
    const sub = this.sub();
    const schedule = sub.scheduleId && this.schedules.get(sub.scheduleId);
    if (schedule) { this.setState(sub, schedule.target); sub.scheduleId = null; }
    const length = (sub.state.interval === "annual" ? 365 : 30) * DAY;
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd += length;
    sub.latestInvoiceId = this.next("in_cycle");
    sub.latestInvoiceStatus = paid ? "paid" : "open";
    if (paid) sub.paidPeriodEnd = sub.currentPeriodEnd;
    else sub.status = "past_due";
  }
  async changePayment(_row, operation) {
    const invoice = this.invoices.get(operation.invoiceId);
    return { paid: invoice.status === "paid", voided: invoice.status === "void", periodEnd: invoice.periodEnd,
      url: `https://invoice.stripe.com/i/${operation.invoiceId}` };
  }
  async releaseSchedule(id, key) {
    this.call("releaseSchedule", { id, key });
    for (const sub of this.subs) if (sub.scheduleId === id) sub.scheduleId = null;
    this.answered("releaseSchedule");
  }
  async voidInvoice(id, key) {
    this.call("voidInvoice", { id, key });
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.status === "paid") return;
    invoice.status = "void";
    const sub = this.sub(invoice.subscriptionId);
    sub.pendingUpdate = false;
    sub.latestInvoiceStatus = "void";
  }
  async setCancellation(id, cancel, key) {
    this.call("setCancellation", { id, cancel, key });
    this.sub(id).cancelAtPeriodEnd = cancel;
    this.answered("setCancellation");
  }
  async revertState(sub, value, key) { this.call("revertState", { subId: sub.id, value, key }); this.setState(this.sub(sub.id), value); }
  async upcomingRenewal(sub) {
    if (sub.cancelAtPeriodEnd || sub.pendingUpdate) return null;
    const schedule = sub.scheduleId && this.schedules.get(sub.scheduleId);
    const next = schedule ? schedule.target : sub.state;
    return { at: sub.currentPeriodEnd, amount: recurringAmount(next), state: next, subtotal: recurringAmount(next) };
  }
  async billingDetails() { return { invoices: [], paymentMethod: null }; }
  async pauseCollection(id, key) { this.call("pauseCollection", { id, key }); this.sub(id).collectionPaused = true; return { pausedInvoiceIds: ["in_retry"] }; }
  async resumeCollection(id, paused, key) { this.call("resumeCollection", { id, paused, key }); this.sub(id).collectionPaused = false; }
  async paymentContext(ref) { this.call("paymentContext", ref); return copy(this.payment || null); }
  async getDispute(id) { return copy(this.dispute || { id, status: "needs_response" }); }
  async getFraudWarning(id) { return copy(this.warning || { id }); }
  async recentEvents() { return copy(this.recent || []); }
}

// Servicio con cuenta y suscripción vigentes en un estado pagado.
function paidSetup(value, { seats, sub: subOverrides, account: accountOverrides, env } = {}) {
  const config = sandboxConfig(env);
  const stripe = new FakeStripe();
  const sub = subscription(value, subOverrides);
  stripe.subs.push(sub);
  const repository = new MemoryRepository(account({ status: "active", subscriptionId: sub.id, tier: value.tier, interval: value.interval,
    extraSeats: value.extraSeats, paidUntil: new Date(sub.paidPeriodEnd * 1000), currentPeriodEnd: new Date(sub.currentPeriodEnd * 1000),
    ...accountOverrides }), seats);
  const service = new TrainerBillingService(config, repository, stripe);
  return { config, stripe, repository, service, sub };
}

module.exports = { USER_ID, CUSTOMER_ID, DAY, CATALOG, copy, nowSeconds, errorCode, fake, sandboxEnv, sandboxConfig, priceId, priceRef,
  stripePrice, catalogStripePrices, state, encode, itemsFor, phaseItems, subscription, account, session, event, MemoryRepository,
  FakeStripe, paidSetup, sameState };
