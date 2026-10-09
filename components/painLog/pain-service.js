const painDao = require("./pain-dao");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");
const { invalidate, invalidateForClient } = require("../coachAlerts/evaluation-cache");

// Registro de dolor del cliente y umbrales del profesional (pain-dao.js).

// Los últimos `days` días hasta `today` (incluido).
const lastDays = (today, days) => [addDaysToIsoDate(today, -(days - 1)), today];

module.exports = {
  listForDate: (userId, date) => painDao.listForDate(userId, date),

  listLastDays: (userId, today, days) => painDao.listForRange(userId, ...lastDays(today, days)),

  // Un dolor nuevo puede disparar las alertas de su profesional en el acto.
  async upsertEntry(userId, date, entry) {
    const saved = await painDao.upsertEntry(userId, date, entry);
    await invalidateForClient(userId);
    return saved;
  },

  async removeEntry(userId, date, zone) {
    const result = await painDao.removeEntry(userId, date, zone);
    await invalidateForClient(userId);
    return result;
  },

  // Histórico del cliente (en su calendario) y los umbrales que le puso este
  // profesional, juntos: la ficha los enseña en la misma tarjeta.
  async clientPain(trainerId, clientId, days) {
    const today = await todayForUser(clientId);
    const [entries, thresholds] = await Promise.all([
      painDao.listForRange(clientId, ...lastDays(today, days)),
      painDao.listThresholds(trainerId, clientId),
    ]);
    return { entries, thresholds };
  },

  // El umbral decide la alerta de dolor (coach-signals-service.js#detectHighPain).
  async upsertThreshold(trainerId, clientId, threshold) {
    const saved = await painDao.upsertThreshold(trainerId, clientId, threshold);
    invalidate(trainerId);
    return saved;
  },

  async removeThreshold(trainerId, clientId, zone) {
    const result = await painDao.removeThreshold(trainerId, clientId, zone);
    invalidate(trainerId);
    return result;
  },
};
