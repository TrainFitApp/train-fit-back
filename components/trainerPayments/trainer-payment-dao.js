const mongoose = require("mongoose");
const TrainerPayment = require("./trainer-payment-schema");
const TrainerPaymentProfile = require("./trainer-payment-profile-schema");
const TrainerPaymentSettings = require("./trainer-payment-settings-schema");
const mapper = require("./trainer-payment-mapper");
const { load: core } = require("./core");

const { toOid } = mapper;
const DUPLICATE_KEY = 11000;

// Normalización dentro de Mongo para agregar sobre cobros nuevos y antiguos a
// la vez, con la MISMA semántica que ledger.ts#normalizeCharge (lo comprueba
// trainer-payments-db.test.js): un cobro antiguo pagado cuenta su importe
// entero como recibido en el día (Madrid) en que se marcó pagado.
function normalizeStages(today) {
  const LEGACY_TIME_ZONE = core().LEGACY_TIME_ZONE;
  const legacyAmount = { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0] };
  const legacyPaid = { $ifNull: ["$paidAt", false] };
  return [
    {
      $addFields: {
        _v2: { $gte: [{ $ifNull: ["$schemaVersion", 0] }, 2] },
        _amountCents: { $ifNull: ["$amountCents", legacyAmount] },
        _currency: { $toUpper: { $ifNull: ["$currency", "EUR"] } },
        _dueDay: {
          $ifNull: ["$dueDay", { $dateToString: { date: "$dueDate", format: "%Y-%m-%d", timezone: LEGACY_TIME_ZONE } }],
        },
      },
    },
    {
      $addFields: {
        _received: { $ifNull: ["$receivedCents", { $cond: [legacyPaid, "$_amountCents", 0] }] },
        _cancelled: { $ifNull: ["$cancelledCents", 0] },
        _status: { $ifNull: ["$status", { $cond: [legacyPaid, "settled", "open"] }] },
        _movements: {
          $cond: [
            "$_v2",
            { $ifNull: ["$payments", []] },
            {
              $cond: [
                legacyPaid,
                [
                  {
                    amountCents: "$_amountCents",
                    status: "valid",
                    receivedDay: { $dateToString: { date: "$paidAt", format: "%Y-%m-%d", timezone: LEGACY_TIME_ZONE } },
                  },
                ],
                [],
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        _balance: { $subtract: ["$_amountCents", { $add: ["$_received", "$_cancelled"] }] },
        _forecast: {
          $and: [
            { $eq: ["$origin", "recurring"] },
            { $eq: ["$_status", "open"] },
            { $gt: ["$_dueDay", today] },
            { $eq: ["$_received", 0] },
            { $eq: ["$_cancelled", 0] },
          ],
        },
        // Orden operativo: vencidos, hoy, próximos, histórico.
        _group: {
          $switch: {
            branches: [
              { case: { $ne: ["$_status", "open"] }, then: 3 },
              { case: { $lt: ["$_dueDay", today] }, then: 0 },
              { case: { $eq: ["$_dueDay", today] }, then: 1 },
            ],
            default: 2,
          },
        },
      },
    },
    {
      $addFields: {
        _dayNumber: { $toInt: { $replaceAll: { input: "$_dueDay", find: "-", replacement: "" } } },
      },
    },
    { $addFields: { _sortKey: { $cond: [{ $lt: ["$_group", 3] }, "$_dayNumber", { $multiply: ["$_dayNumber", -1] }] } } },
  ];
}

module.exports = {
  TrainerPayment,
  TrainerPaymentProfile,
  TrainerPaymentSettings,
  normalizeStages,
  DUPLICATE_KEY,

  // --- Cobros ----------------------------------------------------------------

  async findCharge(trainerId, clientId, chargeId) {
    if (!mongoose.isValidObjectId(chargeId)) return null;
    return TrainerPayment.findOne({ _id: chargeId, trainerId, clientId }).lean();
  },

  async findChargeById(chargeId) {
    return TrainerPayment.findById(chargeId).lean();
  },

  async listClientCharges(trainerId, clientId) {
    return TrainerPayment.find({ trainerId, clientId }).sort({ dueDay: 1, dueDate: 1, _id: 1 }).lean();
  },

  async listChargesByIds(ids) {
    const valid = ids.filter((id) => mongoose.isValidObjectId(id));
    if (!valid.length) return [];
    return TrainerPayment.find({ _id: { $in: valid } }).lean();
  },

  // Recurrentes abiertos desde `fromDay` (candidatos a anular o reajustar al
  // cambiar la cuota). `filter`: una pareja, un entrenador o un cliente.
  async listOpenRecurring(filter, fromDay) {
    return TrainerPayment.find({ ...filter, origin: "recurring", status: "open", dueDay: { $gte: fromDay } }).lean();
  },

  async existingOccurrenceKeys(keys) {
    if (!keys.length) return new Set();
    const docs = await TrainerPayment.find({ planOccurrenceKey: { $in: keys } }).select("planOccurrenceKey").lean();
    return new Set(docs.map((doc) => doc.planOccurrenceKey));
  },

  // insertMany sin orden: si otro proceso ya creó un vencimiento, su clave
  // única lo rechaza y el resto se inserta igual.
  async insertCharges(docs) {
    if (!docs.length) return { inserted: 0, duplicates: 0 };
    try {
      const result = await TrainerPayment.insertMany(docs, { ordered: false, lean: true });
      return { inserted: result.length, duplicates: 0 };
    } catch (error) {
      const writeErrors = error.writeErrors || [];
      if (!writeErrors.length || writeErrors.some((item) => (item.code ?? item.err?.code) !== DUPLICATE_KEY)) throw error;
      return { inserted: docs.length - writeErrors.length, duplicates: writeErrors.length };
    }
  },

  async createCharge(doc) {
    return TrainerPayment.create(doc);
  },

  async findByCreateOperation(trainerId, operationId) {
    return TrainerPayment.findOne({ trainerId, createOperationId: operationId }).lean();
  },

  // Compare-and-swap: solo escribe si nadie ha tocado el cobro desde que se
  // leyó. Un cobro antiguo sin migrar se protege por la ausencia de schemaVersion.
  async casWrite(before, after) {
    const filter = { _id: toOid(before.id), trainerId: toOid(before.trainerId), clientId: toOid(before.clientId) };
    if (before.persistedV2) filter.revision = before.revision;
    else filter.schemaVersion = { $exists: false };
    const set = mapper.chargeToSet(after, { syncDueDate: before.dueDay !== after.dueDay });
    const result = await TrainerPayment.updateOne(filter, { $set: set });
    return result.matchedCount === 1;
  },

  // Registro de hitos: $push condicionado, idempotente entre procesos.
  async pushReminderLog(chargeId, entry) {
    const result = await TrainerPayment.updateOne(
      { _id: chargeId, "reminderLog.key": { $ne: entry.key } },
      { $push: { reminderLog: entry } }
    );
    return result.modifiedCount === 1;
  },

  // Abiertos (v2) con vencimiento en [fromDay, toDay]. `filter`: un
  // entrenador ({trainerId}) o un cliente ({clientId, trainerId: {$in}}).
  async listOpenDueBetween(filter, fromDay, toDay) {
    return TrainerPayment.find({ ...filter, schemaVersion: 2, status: "open", dueDay: { $gte: fromDay, $lte: toDay } }).lean();
  },

  // Pendientes informativos de un cliente con sus profesionales activos.
  async listOpenForClient(clientId, trainerIds) {
    if (!trainerIds.length) return [];
    return TrainerPayment.find({
      clientId,
      trainerId: { $in: trainerIds },
      $or: [{ schemaVersion: 2, status: "open" }, { schemaVersion: { $exists: false }, paidAt: null }],
    })
      .sort({ dueDay: 1, dueDate: 1 })
      .lean();
  },

  async aggregate(pipeline) {
    return TrainerPayment.aggregate(pipeline);
  },

  // --- Perfiles (cuota + preferencias por pareja) ------------------------------

  async findProfile(trainerId, clientId) {
    return TrainerPaymentProfile.findOne({ trainerId, clientId }).lean();
  },

  async listProfiles(filter) {
    return TrainerPaymentProfile.find(filter).lean();
  },

  // Upsert concurrente seguro: el índice único deja un solo documento.
  async ensureProfile(trainerId, clientId) {
    try {
      return await TrainerPaymentProfile.findOneAndUpdate(
        { trainerId, clientId },
        { $setOnInsert: { trainerId, clientId, revision: 0 } },
        { upsert: true, new: true, lean: true }
      );
    } catch (error) {
      if (error.code !== DUPLICATE_KEY) throw error;
      return TrainerPaymentProfile.findOne({ trainerId, clientId }).lean();
    }
  },

  async casWriteProfile(before, after) {
    const result = await TrainerPaymentProfile.updateOne(
      { _id: toOid(before.id), revision: before.revision },
      { $set: mapper.profileToSet(after) }
    );
    return result.matchedCount === 1;
  },

  // Cursor de materialización: $max sobre "YYYY-MM-DD" nunca retrocede.
  async advanceCursor(profileId, segment, day) {
    await TrainerPaymentProfile.updateOne(
      { _id: profileId, "plan.segment": segment, "plan.status": "active" },
      { $max: { "plan.materializedThrough": day } }
    );
  },

  // --- Preferencias del entrenador ---------------------------------------------

  async findSettings(trainerId) {
    return TrainerPaymentSettings.findOne({ trainerId }).lean();
  },

  async listSettings(trainerIds) {
    if (!trainerIds.length) return [];
    return TrainerPaymentSettings.find({ trainerId: { $in: trainerIds } }).lean();
  },

  async saveSettings(trainerId, settings, now) {
    return TrainerPaymentSettings.findOneAndUpdate(
      { trainerId },
      {
        $set: { timeZone: settings.timeZone, time: settings.time, offsets: settings.offsets },
        $inc: { revision: 1 },
        $push: { history: { $each: [{ at: now, ...settings }], $slice: -20 } },
      },
      { upsert: true, new: true, lean: true }
    );
  },
};
