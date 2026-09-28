const anthropometryDao = require("./anthropometry-dao");
const { ownView, ownViews } = require("./anthropometry-origin");

// `ownOnly`: pantallas del cliente, sin lo que vino de check-ins. El
// entrenador lee sin filtrar.
module.exports = {
  async createAnthropometry(userId, date, data) {
    return ownView(await anthropometryDao.upsertOwnFields(userId, date, data));
  },

  async getAnthropometryById(id, { ownOnly = false } = {}) {
    const doc = await anthropometryDao.getAnthropometryById(id);
    return ownOnly ? ownView(doc) : doc;
  },

  async getAnthropometryByUserIdAndDate(userId, date, { ownOnly = false } = {}) {
    const doc = await anthropometryDao.getAnthropometryByUserIdAndDate(userId, date);
    return ownOnly ? ownView(doc) : doc;
  },

  async getAnthropometriesByUserIdBetweenDates(userId, minDate, maxDate, { ownOnly = false } = {}) {
    const docs = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(userId, minDate, maxDate);
    return ownOnly ? ownViews(docs) : docs;
  },

  async getAllAnthropometriesByUserId(userId, { ownOnly = false } = {}) {
    const docs = await anthropometryDao.getAllAnthropometriesByUserId(userId);
    return ownOnly ? ownViews(docs) : docs;
  },

  async updateAnthropometry(id, data) {
    const existing = await anthropometryDao.getAnthropometryById(id);
    if (!existing) return null;
    return ownView(await anthropometryDao.upsertOwnFields(existing.userId, existing.date, data));
  },

  async deleteAnthropometry(id) {
    return anthropometryDao.deleteAnthropometry(id);
  },

  // Escritura del propio cliente (peso diario, modal de medidas).
  async upsertAnthropometry(userId, date, data) {
    return ownView(await anthropometryDao.upsertOwnFields(userId, date, data));
  },
};
