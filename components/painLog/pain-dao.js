const { PainEntry } = require("./pain-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

module.exports = {
  // Upsert: el cliente CORRIGE su registro del día, no acumula filas. El
  // índice único {userId, date, zone} lo garantiza aunque llegue dos veces.
  async upsertEntry(userId, date, { zone, level, note }) {
    return PainEntry.findOneAndUpdate(
      { userId, date, zone },
      { $set: { level, note } },
      { new: true, upsert: true }
    ).lean();
  },

  async removeEntry(userId, date, zone) {
    return PainEntry.deleteOne({ userId, date, zone });
  },

  async listForDate(userId, date) {
    return PainEntry.find({ userId, date }).lean();
  },

  async listForRange(userId, fromDate, toDate) {
    return PainEntry.find({ userId, date: { $gte: fromDate, $lte: toDate } })
      .sort({ date: 1 })
      .lean();
  },

  // Movimiento 3 Coach Pro — el dolor de TODA la cartera en una consulta,
  // para que el motor de reglas pueda condicionar sobre él sin pasar de N
  // consultas por profesional (mismo criterio que
  // listCompletedWorkoutDatesForUsers en table-dao.js).
  async listForUsersSince(userIds, fromDate) {
    if (!userIds?.length) return [];
    return PainEntry.find({ userId: { $in: userIds }, date: { $gte: fromDate } })
      .select("userId date zone level")
      .sort({ date: 1 })
      .lean();
  },

  // --- Umbrales (los fija el profesional; viven en el par, ver
  // trainerClients/trainer-client-schema.js) ---
  async listThresholds(trainerId, clientId) {
    return trainerClientDao.listPainThresholds(trainerId, clientId);
  },

  async upsertThreshold(trainerId, clientId, threshold) {
    return trainerClientDao.setPainThreshold(trainerId, clientId, threshold);
  },

  async removeThreshold(trainerId, clientId, zone) {
    return trainerClientDao.removePainThreshold(trainerId, clientId, zone);
  },
};
