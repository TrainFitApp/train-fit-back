const painDao = require("./pain-dao");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");

// Registro de dolor del cliente y umbrales del profesional (pain-dao.js).

// Los últimos `days` días hasta `today` (incluido).
const lastDays = (today, days) => [addDaysToIsoDate(today, -(days - 1)), today];

module.exports = {
  listForDate: (userId, date) => painDao.listForDate(userId, date),

  listLastDays: (userId, today, days) => painDao.listForRange(userId, ...lastDays(today, days)),

  upsertEntry: (userId, date, entry) => painDao.upsertEntry(userId, date, entry),

  removeEntry: (userId, date, zone) => painDao.removeEntry(userId, date, zone),

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

  upsertThreshold: (trainerId, clientId, threshold) => painDao.upsertThreshold(trainerId, clientId, threshold),

  removeThreshold: (trainerId, clientId, zone) => painDao.removeThreshold(trainerId, clientId, zone),
};
