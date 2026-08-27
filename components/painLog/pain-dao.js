const { PainEntry, PainThreshold } = require("./pain-schema");

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

  // --- Umbrales (los fija el entrenador) ---
  async listThresholds(trainerId, clientId) {
    return PainThreshold.find({ trainerId, clientId }).lean();
  },

  async upsertThreshold(trainerId, clientId, { zone, workLevel, painLevel, note }) {
    return PainThreshold.findOneAndUpdate(
      { trainerId, clientId, zone },
      { $set: { workLevel, painLevel, note } },
      { new: true, upsert: true }
    ).lean();
  },

  // trainerId en el filtro, no solo la zona: impide que un profesional borre
  // el umbral que puso otro sobre el mismo cliente. Mismo criterio que el
  // resto de DAOs del módulo trainer.
  async removeThreshold(trainerId, clientId, zone) {
    return PainThreshold.deleteOne({ trainerId, clientId, zone });
  },
};
