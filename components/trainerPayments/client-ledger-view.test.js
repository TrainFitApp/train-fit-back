const test = require("node:test");
const assert = require("node:assert/strict");
const { clientLedgerView } = require("./client-ledger-view");

const plan = {
  status: "active",
  concept: "Cuota mensual",
  currency: "EUR",
  unit: "month",
  interval: 1,
  amountCents: 6000,
  nextDueDay: "2026-11-05",
  anchorDay: "2026-09-05",
  scheduledPrice: null,
  startedAt: new Date("2026-09-01T10:00:00Z"),
  pausedAt: null,
  endedAt: null,
  endReason: null,
  history: [{ type: "created" }],
};

const summary = {
  state: "overdue",
  currency: "EUR",
  overdue: { balanceCents: 4000, count: 1, oldestDueDay: "2026-10-05" },
  dueToday: null,
  next: { dueDay: "2026-11-05", amountCents: 6000, chargeId: null, origin: "plan" },
  pendingCents: 4000,
  openCount: 1,
  plan: { status: "active" },
  otherCurrencies: [],
  needsReview: 1,
  hasCharges: true,
};

const charge = (fields) => ({
  id: "c1",
  clientId: "client",
  origin: "recurring",
  concept: "Cuota mensual",
  note: "Nota privada del entrenador",
  currency: "EUR",
  dueDay: "2026-10-05",
  amountCents: 6000,
  originalAmountCents: 6000,
  receivedCents: 2000,
  cancelledCents: 0,
  balanceCents: 4000,
  status: "open",
  voidReason: null,
  temporal: "overdue",
  forecast: false,
  historical: false,
  manualOverride: false,
  paymentsCount: 1,
  lastReceivedDay: "2026-10-06",
  settledAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  revision: 3,
  anomalies: ["currency"],
  payments: [
    { id: "p1", amountCents: 1500, receivedDay: "2026-10-01", method: "bizum", note: "privada", recordedAt: new Date(), source: "app", status: "voided" },
    { id: "p2", amountCents: 500, receivedDay: "2026-10-02", method: "cash", note: null, recordedAt: new Date(), source: "app", status: "valid" },
    { id: "p3", amountCents: 1500, receivedDay: "2026-10-06", method: "bizum", note: "privada", recordedAt: new Date(), source: "app", status: "valid" },
  ],
  adjustments: [{ id: "a1", type: "note_changed" }],
  ...fields,
});

test("cobros del cliente: sin notas, métodos, anomalías, ajustes ni pagos anulados", () => {
  const view = clientLedgerView({ today: "2026-10-09", plan, summary, charges: [charge()] });
  const json = JSON.stringify(view);

  for (const secret of ["Nota privada", "privada", "bizum", "cash", "anomalies", "adjustments", "method", "note", "history", "needsReview"]) {
    assert.ok(!json.includes(secret), `no debe salir «${secret}»`);
  }
  assert.deepEqual(view.charges[0].payments, [
    { id: "p3", amountCents: 1500, receivedDay: "2026-10-06" },
    { id: "p2", amountCents: 500, receivedDay: "2026-10-02" },
  ]);
  assert.equal(view.charges[0].balanceCents, 4000);
  assert.equal(view.plan.amountCents, 6000);
  assert.deepEqual(view.summary.next, { dueDay: "2026-11-05", amountCents: 6000 });
  assert.deepEqual(view.summary.overdue, { balanceCents: 4000, count: 1, oldestDueDay: "2026-10-05" });
});

test("cobros del cliente: previsiones y anulados no salen como cobro; sin cuota, plan null", () => {
  const view = clientLedgerView({
    today: "2026-10-09",
    plan: null,
    summary: { ...summary, state: "no_pending", overdue: null, next: null, pendingCents: 0 },
    charges: [
      charge({ id: "forecast", forecast: true, temporal: "upcoming", receivedCents: 0, payments: [] }),
      charge({ id: "void", status: "void", temporal: "closed" }),
      charge({ id: "settled", status: "settled", temporal: "closed", balanceCents: 0 }),
    ],
  });

  assert.equal(view.plan, null);
  assert.deepEqual(view.charges.map((item) => item.id), ["settled"]);
  assert.equal(view.summary.next, null);
});
