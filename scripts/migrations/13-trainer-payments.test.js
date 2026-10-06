const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const TrainerPayment = require("../../components/trainerPayments/trainer-payment-schema");
const mapper = require("../../components/trainerPayments/trainer-payment-mapper");
const C = require("../../components/trainerPayments/core").load();
const { migrateTrainerPayments } = require("./13-trainer-payments");

const db = useTestDb();

test("cobros planos y de transición pasan a la forma del libro; los dudosos se marcan; avisos y totales cuadran", async () => {
  await db.reset();
  const payments = db.raw("trainerpayments");
  await payments.dropIndexes().catch(() => {});
  await payments.createIndex({ trainerId: 1, clientId: 1, dueDate: -1 });
  const [trainer, client, unpaid, paid, usd, ambiguous, transition, notice] = Array.from({ length: 8 }, () => db.oid());
  const base = { trainerId: trainer, clientId: client, createdAt: new Date("2026-08-01T10:00:00Z") };
  await payments.insertMany([
    { _id: unpaid, ...base, amount: 60, currency: "EUR", dueDate: new Date("2026-08-05T00:00:00Z"), paidAt: null, note: "agosto" },
    // Medianoche de Madrid y pagado: un pago "marcado", sin método ni autor.
    { _id: paid, ...base, amount: 45.5, currency: "EUR", dueDate: new Date("2026-07-04T22:00:00Z"), paidAt: new Date("2026-07-07T09:30:00Z") },
    { _id: usd, ...base, amount: 20, currency: "USD", dueDate: new Date("2026-08-05T00:00:00Z"), paidAt: null },
    { _id: ambiguous, ...base, amount: 10, currency: "EUR", dueDate: new Date("2026-09-05T23:30:00Z"), paidAt: null },
    // Escrito por la versión de transición: forma nueva + campos viejos.
    {
      _id: transition, ...base, schemaVersion: 2, origin: "legacy", concept: null, note: null, currency: "EUR", dueDay: "2026-09-05",
      amountCents: 3000, originalAmountCents: 3000, receivedCents: 3000, cancelledCents: 0, status: "settled",
      settledAt: new Date("2026-09-06"), payments: [{ _id: db.oid(), amountCents: 3000, receivedDay: "2026-09-06", receivedDaySource: "legacy_marked_paid",
        method: "unknown", note: null, recordedAt: new Date("2026-09-06"), recordedBy: trainer, source: "legacy_toggle", operationId: "legacy-toggle:x:1",
        payloadHash: null, status: "valid" }],
      adjustments: [], operations: [], revision: 2, dueRevision: 1, remindersFrom: new Date("2026-09-01"), reminderLog: [],
      amount: 30, dueDate: new Date("2026-09-05T12:00:00Z"), paidAt: new Date("2026-09-06"),
      legacy: { sourceAmount: 30, migratedBy: "write" },
    },
  ]);
  await db.raw("notifications").insertOne({
    _id: notice, clientId: client, trainerId: trainer, recipient: "client", type: "payment_created",
    payload: { chargeId: String(unpaid), amount: 60, amountCents: 6000, currency: "EUR", dueDate: new Date("2026-08-05T12:00:00Z"), dueDay: "2026-08-05" },
  });
  const conn = db.mongoose.connection.db;

  const preview = await migrateTrainerPayments(conn, { dryRun: true });
  assert.equal(preview.converted, 4);
  assert.deepEqual(preview.renamed, { origin: 1, toggledPayments: 1, markedPaidDays: 1 });
  assert.equal(preview.notifications, 1);
  assert.equal((await payments.findOne({ _id: paid })).amountCents, undefined, "en seco no escribe");

  const stats = await migrateTrainerPayments(conn, { now: new Date("2026-10-06T08:00:00Z") });
  assert.equal(stats.totalsMatch, true);
  assert.deepEqual(stats.totalsAfter[`${trainer}|EUR`], { charges: 4, amountCents: 14550, receivedCents: 7550, pendingCents: 7000, movements: 2 });
  assert.deepEqual(
    stats.withAnomalies.map((item) => [item.id, item.anomalies]).sort(),
    [[String(ambiguous), ["ambiguous_due_date"]], [String(usd), ["non_eur_currency"]]].sort()
  );
  assert.deepEqual(stats.droppedIndexes, ["trainerId_1_clientId_1_dueDate_-1"]);

  const raw = await payments.find({}).toArray();
  for (const doc of raw) {
    for (const field of ["amount", "dueDate", "paidAt", "schemaVersion", "legacy"]) assert.equal(field in doc, false, `${doc._id} sin ${field}`);
  }
  const convertedPaid = raw.find((doc) => String(doc._id) === String(paid));
  assert.equal(convertedPaid.dueDay, "2026-07-05", "medianoche de Madrid, no el día UTC");
  assert.deepEqual(
    [convertedPaid.status, convertedPaid.payments[0].receivedDaySource, convertedPaid.payments[0].source, convertedPaid.payments[0].method],
    ["settled", "marked_paid", "migration", "unknown"]
  );
  const fixed = raw.find((doc) => String(doc._id) === String(transition));
  assert.deepEqual([fixed.origin, fixed.payments[0].source, fixed.payments[0].receivedDaySource], ["one_off", "app", "marked_paid"]);

  // La app lee y valida el resultado tal cual.
  for (const doc of await TrainerPayment.find({}).lean()) {
    const charge = C.normalizeCharge(mapper.toChargeRecord(doc));
    assert.deepEqual(C.verifyCharge(charge), [], `cobro ${doc._id} coherente`);
    await TrainerPayment.validate(doc);
  }

  const payload = (await db.raw("notifications").findOne({ _id: notice })).payload;
  assert.deepEqual([payload.amountCents, payload.dueDay, "amount" in payload, "dueDate" in payload], [6000, "2026-08-05", false, false]);

  const again = await migrateTrainerPayments(conn);
  assert.deepEqual([again.converted, again.oldFields, again.notifications], [0, 0, 0]);
  assert.equal(again.totalsMatch, true);
});
