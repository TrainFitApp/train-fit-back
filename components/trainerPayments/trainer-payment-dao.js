const mongoose = require("mongoose");
const TrainerPayment = require("./trainer-payment-schema");
const TrainerPaymentProfile = require("./trainer-payment-profile-schema");
const User = require("../users/user-schema");
const mapper = require("./trainer-payment-mapper");

const { toOid } = mapper;
const DUPLICATE_KEY = 11000;
const SETTINGS_PATH = "trainerSettings.payments";

function presentSettings(user) {
  const settings = user?.trainerSettings?.payments;
  return settings ? { trainerId: user._id, ...settings } : null;
}

// Campos derivados para agregar en Mongo con la misma semántica que el núcleo
// (ledger.ts#balanceOf, isForecast y el orden operativo de la lista).
function derivedStages(today) {
  return [
    {
      $addFields: {
        _balance: { $subtract: ["$amountCents", { $add: ["$receivedCents", "$cancelledCents"] }] },
        _forecast: {
          $and: [
            { $eq: ["$origin", "recurring"] },
            { $eq: ["$status", "open"] },
            { $gt: ["$dueDay", today] },
            { $eq: ["$receivedCents", 0] },
            { $eq: ["$cancelledCents", 0] },
          ],
        },
        // Orden operativo: vencidos, hoy, próximos, histórico.
        _group: {
          $switch: {
            branches: [
              { case: { $ne: ["$status", "open"] }, then: 3 },
              { case: { $lt: ["$dueDay", today] }, then: 0 },
              { case: { $eq: ["$dueDay", today] }, then: 1 },
            ],
            default: 2,
          },
        },
      },
    },
    {
      $addFields: {
        _dayNumber: { $toInt: { $replaceAll: { input: "$dueDay", find: "-", replacement: "" } } },
      },
    },
    { $addFields: { _sortKey: { $cond: [{ $lt: ["$_group", 3] }, "$_dayNumber", { $multiply: ["$_dayNumber", -1] }] } } },
  ];
}

module.exports = {
  TrainerPayment,
  TrainerPaymentProfile,
  derivedStages,
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
    return TrainerPayment.find({ trainerId, clientId }).sort({ dueDay: 1, _id: 1 }).lean();
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

  // Compare-and-swap: solo escribe si nadie ha tocado el cobro desde que se leyó.
  async casWrite(before, after) {
    const filter = {
      _id: toOid(before.id),
      trainerId: toOid(before.trainerId),
      clientId: toOid(before.clientId),
      revision: before.revision,
    };
    const set = mapper.chargeToSet(after);
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

  // Abiertos con vencimiento en [fromDay, toDay]. `filter`: un
  // entrenador ({trainerId}) o un cliente ({clientId, trainerId: {$in}}).
  async listOpenDueBetween(filter, fromDay, toDay) {
    return TrainerPayment.find({ ...filter, status: "open", dueDay: { $gte: fromDay, $lte: toDay } }).lean();
  },

  // Pendientes informativos de un cliente con sus profesionales activos.
  async listOpenForClient(clientId, trainerIds) {
    if (!trainerIds.length) return [];
    return TrainerPayment.find({
      clientId,
      trainerId: { $in: trainerIds },
      status: "open",
    })
      .sort({ dueDay: 1 })
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
  // Viven en User.trainerSettings.payments (2026-10). Se devuelven con
  // `trainerId`, como el documento de la colección antigua; null sin ajustes.

  async findSettings(trainerId) {
    if (!mongoose.isValidObjectId(trainerId)) return null;
    const user = await User.findById(trainerId).select(SETTINGS_PATH).lean();
    return presentSettings(user);
  },

  async listSettings(trainerIds) {
    if (!trainerIds.length) return [];
    const users = await User.find({ _id: { $in: trainerIds }, [SETTINGS_PATH]: { $exists: true } })
      .select(SETTINGS_PATH)
      .lean();
    return users.map(presentSettings).filter(Boolean);
  },

  async saveSettings(trainerId, settings, now) {
    const user = await User.findOneAndUpdate(
      { _id: trainerId },
      {
        $set: {
          [`${SETTINGS_PATH}.timeZone`]: settings.timeZone,
          [`${SETTINGS_PATH}.time`]: settings.time,
          [`${SETTINGS_PATH}.offsets`]: settings.offsets,
          [`${SETTINGS_PATH}.updatedAt`]: now,
        },
        $inc: { [`${SETTINGS_PATH}.revision`]: 1 },
        $push: { [`${SETTINGS_PATH}.history`]: { $each: [{ at: now, ...settings }], $slice: -20 } },
      },
      { new: true, projection: { [SETTINGS_PATH]: 1 } }
    ).lean();
    return presentSettings(user);
  },
};
