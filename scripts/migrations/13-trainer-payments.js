// Cobros entre entrenador y cliente: TODO a la forma del libro de pagos
// (2026-10, docs/refactor-modelo-datos-estado.md D1). Sustituye a
// migrate-trainer-payments-v2.js, que dejaba los campos viejos y los cobros
// dudosos sin convertir para que los leyeran las apps anteriores.
//
// - Cobro plano (amount/dueDate/paidAt, sin amountCents) → cobro nuevo con el
//   mismo _id (scripts/lib/trainer-payment-v1.js). TODOS se convierten: lo
//   dudoso (otra divisa, decimales, fechas) queda en `anomalies` y la app
//   pide revisarlo. No envía avisos ni deduce cuotas.
// - Cobros nuevos que aún llevan la forma vieja (los escribía la versión de
//   transición): origin "legacy" → "one_off", pagos "legacy_toggle" → "app",
//   "legacy_marked_paid" → "marked_paid".
// - Fuera amount, dueDate, paidAt, schemaVersion y legacy en todos, y el
//   índice por dueDate.
// - Avisos de cobro: payload.amount/dueDate → amountCents/dueDay.
// - Comprueba antes/después importe, recibido, pendiente y nº de pagos por
//   entrenador y divisa. Repetible: la segunda pasada no encuentra nada.

const { convertV1, V1_TIME_ZONE } = require("../lib/trainer-payment-v1");

const V1_FIELDS = ["amount", "dueDate", "paidAt", "schemaVersion", "legacy"];
const OLD_DUE_DATE_INDEX = "trainerId_1_clientId_1_dueDate_-1";
const PAYMENT_NOTIFICATIONS = ["payment_created", "payment_reminder"];

// Por entrenador y divisa: importe, recibido, pendiente y pagos válidos de lo
// que no está anulado.
function totalsOf(docs) {
  const totals = {};
  for (const doc of docs) {
    if (doc.status === "void") continue;
    const key = `${doc.trainerId}|${doc.currency || "EUR"}`;
    const row = (totals[key] ??= { charges: 0, amountCents: 0, receivedCents: 0, pendingCents: 0, movements: 0 });
    row.charges += 1;
    row.amountCents += doc.amountCents;
    row.receivedCents += doc.receivedCents;
    row.pendingCents += Math.max(0, doc.amountCents - doc.receivedCents - (doc.cancelledCents || 0));
    row.movements += (doc.payments || []).filter((payment) => payment.status === "valid").length;
  }
  return Object.fromEntries(Object.keys(totals).sort().map((key) => [key, totals[key]]));
}

async function migrateTrainerPayments(db, { dryRun = false, now = new Date() } = {}) {
  const C = require("../../components/trainerPayments/core").load();
  const payments = db.collection("trainerpayments");
  const notifications = db.collection("notifications");

  const all = await payments.find({}).toArray();
  const isV1 = (doc) => doc.amountCents === undefined;
  const converted = new Map(all.filter(isV1).map((doc) => [String(doc._id), convertV1(C, doc, { now })]));
  const view = (doc) => (isV1(doc) ? { ...doc, ...converted.get(String(doc._id)) } : doc);

  const stats = {
    dryRun,
    charges: all.length,
    converted: converted.size,
    withAnomalies: [...converted].filter(([, fields]) => fields.anomalies).map(([id, fields]) => ({ id, anomalies: fields.anomalies })),
    renamed: {
      origin: all.filter((doc) => doc.origin === "legacy").length,
      toggledPayments: all.filter((doc) => (doc.payments || []).some((p) => p.source === "legacy_toggle")).length,
      markedPaidDays: all.filter((doc) => (doc.payments || []).some((p) => p.receivedDaySource === "legacy_marked_paid")).length,
    },
    oldFields: all.filter((doc) => V1_FIELDS.some((field) => doc[field] !== undefined)).length,
    notifications: await notifications.countDocuments({
      type: { $in: PAYMENT_NOTIFICATIONS },
      $or: [{ "payload.amount": { $exists: true } }, { "payload.dueDate": { $exists: true } }],
    }),
    droppedIndexes: [],
    totalsBefore: totalsOf(all.map(view)),
    totalsAfter: null,
    totalsMatch: true,
  };
  if (dryRun) return stats;

  for (const [id, fields] of converted) {
    const doc = all.find((candidate) => String(candidate._id) === id);
    await payments.updateOne({ _id: doc._id, amountCents: { $exists: false } }, { $set: fields });
  }
  await payments.updateMany({ origin: "legacy" }, { $set: { origin: "one_off" } });
  await payments.updateMany(
    { "payments.source": "legacy_toggle" },
    { $set: { "payments.$[payment].source": "app" } },
    { arrayFilters: [{ "payment.source": "legacy_toggle" }] }
  );
  await payments.updateMany(
    { "payments.receivedDaySource": "legacy_marked_paid" },
    { $set: { "payments.$[payment].receivedDaySource": "marked_paid" } },
    { arrayFilters: [{ "payment.receivedDaySource": "legacy_marked_paid" }] }
  );
  await payments.updateMany(
    { $or: V1_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
    { $unset: Object.fromEntries(V1_FIELDS.map((field) => [field, ""])) }
  );

  await notifications.updateMany(
    { type: { $in: PAYMENT_NOTIFICATIONS }, $or: [{ "payload.amount": { $exists: true } }, { "payload.dueDate": { $exists: true } }] },
    [
      {
        $set: {
          "payload.amountCents": {
            $ifNull: [
              "$payload.amountCents",
              { $cond: [{ $isNumber: "$payload.amount" }, { $round: [{ $multiply: ["$payload.amount", 100] }, 0] }, "$$REMOVE"] },
            ],
          },
          "payload.dueDay": {
            $ifNull: [
              "$payload.dueDay",
              {
                $cond: [
                  { $eq: [{ $type: "$payload.dueDate" }, "date"] },
                  { $dateToString: { date: "$payload.dueDate", format: "%Y-%m-%d", timezone: V1_TIME_ZONE } },
                  "$$REMOVE",
                ],
              },
            ],
          },
        },
      },
      { $unset: ["payload.amount", "payload.dueDate"] },
    ]
  );

  const indexes = await payments.indexes().catch(() => []);
  if (indexes.some((index) => index.name === OLD_DUE_DATE_INDEX)) {
    await payments.dropIndex(OLD_DUE_DATE_INDEX);
    stats.droppedIndexes.push(OLD_DUE_DATE_INDEX);
  }

  stats.totalsAfter = totalsOf(await payments.find({}).toArray());
  stats.totalsMatch = JSON.stringify(stats.totalsBefore) === JSON.stringify(stats.totalsAfter);
  return stats;
}

module.exports = { migrateTrainerPayments };
