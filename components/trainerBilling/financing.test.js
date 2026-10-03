const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyInvoice, fundingRole, stateFromLines } = require("../../.build/trainer-billing/financing");
const { stateView } = require("../../.build/trainer-billing/config");
const { priceRef, state } = require("./test-support");

const START = 1800000000;
const END = START + 30 * 86400;
const line = (kind, tier, interval, { amount, quantity = 1, proration = false, start = START, end = END, item = `si_${kind}` } = {}) => ({
  amount: amount ?? priceRef(kind, tier, interval).amount * quantity, price: priceRef(kind, tier, interval), quantity, proration,
  subscriptionItem: item, periodStart: start, periodEnd: end });
const invoice = (billingReason, lines, extra = {}) => ({ id: "in_one", subscriptionId: "sub_trainers", customerId: "cus_trainerone",
  billingReason, amountPaid: lines.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0), currency: "eur", lines, ...extra });

test("un periodo es su cuota y sus plazas; Free con plazas no tiene cuota", () => {
  assert.deepEqual(classifyInvoice(invoice("subscription_cycle", [line("base", "starter", "monthly"),
    line("seat", "starter", "monthly", { quantity: 5 })]), null).state, state("starter", "monthly", 5));
  const free = classifyInvoice(invoice("subscription_create", [line("seat", "free", "monthly", { quantity: 4 })]), null);
  assert.equal(free.kind, "period");
  assert.deepEqual(free.state, state("free", "monthly", 4));
  assert.equal(free.periodEnd, END);
  // La plaza adicional con cantidad 0 que queda tras una subida no cuenta.
  assert.deepEqual(classifyInvoice(invoice("subscription_cycle", [line("base", "professional", "annual"),
    line("seat", "professional", "annual", { quantity: 0, amount: 0 })]), null).state, state("professional", "annual", 0));
});

test("la renovación que cobra las prorratas de plazas mensuales sigue siendo un periodo", () => {
  const financed = classifyInvoice(invoice("subscription_cycle", [line("base", "starter", "monthly"),
    line("seat", "starter", "monthly", { quantity: 3 }),
    line("seat", "starter", "monthly", { quantity: 3, amount: 150, proration: true, start: START - 15 * 86400, end: START })]), null);
  assert.equal(financed.kind, "period");
  assert.deepEqual(financed.state, state("starter", "monthly", 3));
});

test("formas que no sabe explicar quedan como desconocidas: nunca se retira acceso a ciegas", () => {
  const unknown = (lines, reason = "subscription_cycle") => assert.equal(classifyInvoice(invoice(reason, lines), null).kind, "unknown");
  unknown([line("base", "starter", "monthly"), line("base", "professional", "monthly")]);
  unknown([line("base", "starter", "monthly"), line("seat", "professional", "monthly", { quantity: 2 })]);
  unknown([line("seat", "starter", "monthly", { quantity: 2 })], "subscription_create");
  unknown([line("base", "starter", "monthly"), line("base", "starter", "monthly", { amount: 100, proration: true })]);
  unknown([{ ...line("base", "starter", "monthly"), price: null }]);
  unknown([line("base", "starter", "monthly")], "manual");
  // Una factura de cambio que Trainers no registró tampoco se interpreta.
  unknown([line("base", "professional", "monthly", { amount: 1000, proration: true })], "subscription_update");
});

test("el cobro de una subida se identifica por el cambio que registró Trainers, con el estado anterior", () => {
  const from = stateView(state("starter", "monthly", 5));
  const to = stateView(state("starter", "monthly", 15));
  const change = { invoiceId: "in_one", status: "applied", quote: { kind: "immediate", from, to } };
  const lines = [line("seat", "starter", "monthly", { quantity: 5, amount: -250, proration: true, start: START + 86400 }),
    line("seat", "starter", "monthly", { quantity: 15, amount: 750, proration: true, start: START + 86400 })];
  const financed = classifyInvoice(invoice("subscription_update", lines), { change });
  assert.equal(financed.kind, "upgrade");
  assert.deepEqual(financed.state, state("starter", "monthly", 15));
  assert.deepEqual(financed.fromState, state("starter", "monthly", 5));
  assert.equal(financed.periodStart, START + 86400);
  // Mensual → anual se distingue de una subida en la misma periodicidad.
  const annual = classifyInvoice(invoice("subscription_update", [line("base", "starter", "annual", { proration: true })]),
    { change: { ...change, quote: { kind: "immediate", from, to: stateView(state("starter", "annual", 5)) } } });
  assert.equal(annual.kind, "interval_change");
  // Otra factura distinta de la del cambio: desconocida.
  assert.equal(classifyInvoice(invoice("subscription_update", lines, { id: "in_other" }), { change }).kind, "unknown");
  // Un cambio programado no tiene factura propia.
  assert.equal(classifyInvoice(invoice("subscription_update", lines), { change: { ...change, quote: { ...change.quote, kind: "scheduled" } } }).kind, "unknown");
});

test("stateFromLines solo acepta una cuota con cantidad 1 y plazas del mismo plan y periodicidad", () => {
  const base = { price: priceRef("base", "starter", "monthly"), quantity: 1 };
  assert.deepEqual(stateFromLines(base, { price: priceRef("seat", "starter", "monthly"), quantity: 2 }), state("starter", "monthly", 2));
  assert.equal(stateFromLines({ ...base, quantity: 2 }, undefined), null);
  assert.equal(stateFromLines(base, { price: priceRef("seat", "starter", "annual"), quantity: 2 }), null);
  assert.equal(stateFromLines(undefined, undefined), null);
});

test("fundingRole liga un pago al acceso de hoy solo cuando hay certeza", () => {
  const now = START + 10 * 86400;
  const current = { subscriptionId: "sub_trainers", state: state("starter", "monthly", 15) };
  const period = { kind: "period", invoiceId: "in_one", subscriptionId: "sub_trainers", state: state("starter", "monthly", 5),
    fromState: null, periodStart: START, periodEnd: END, amountPaid: 3400, currency: "eur" };
  assert.equal(fundingRole(period, current, now), "current_period");
  assert.equal(fundingRole({ ...period, periodEnd: now - 1 }, current, now), "past");
  assert.equal(fundingRole({ ...period, subscriptionId: "sub_other" }, current, now), "unknown");
  assert.equal(fundingRole({ ...period, periodStart: now + 1 }, current, now), "unknown");
  const upgrade = { ...period, kind: "upgrade", state: state("starter", "monthly", 15), fromState: state("starter", "monthly", 5) };
  assert.equal(fundingRole(upgrade, current, now), "current_upgrade");
  assert.equal(fundingRole(upgrade, { ...current, state: state("professional", "monthly", 0) }, now), "unknown",
    "otra subida posterior ya la sustituyó");
  assert.equal(fundingRole({ ...period, kind: "unknown" }, current, now), "unknown");
});
