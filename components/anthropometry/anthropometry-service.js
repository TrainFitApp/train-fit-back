const anthropometryDao = require("./anthropometry-dao");

module.exports = {
  async createAnthropometry(data) {
    return anthropometryDao.createAnthropometry(data);
  },

  async getAnthropometryById(id) {
    return anthropometryDao.getAnthropometryById(id);
  },

  async getAnthropometryByUserIdAndDate(userId, date) {
    return anthropometryDao.getAnthropometryByUserIdAndDate(userId, date);
  },

  async getAnthropometriesByUserIdBetweenDates(userId, minDate, maxDate) {
    return anthropometryDao.getAnthropometriesByUserIdBetweenDates(userId, minDate, maxDate);
  },

  async getAllAnthropometriesByUserId(userId) {
    return anthropometryDao.getAllAnthropometriesByUserId(userId);
  },

  async updateAnthropometry(id, data) {
    return anthropometryDao.updateAnthropometry(id, data);
  },

  async deleteAnthropometry(id) {
    return anthropometryDao.deleteAnthropometry(id);
  },

  async upsertAnthropometry(userId, date, data) {
    const existing = await anthropometryDao.getAnthropometryByUserIdAndDate(userId, date);
    if (existing) {
      return anthropometryDao.updateAnthropometry(existing._id, data);
    }
    return anthropometryDao.createAnthropometry({ userId, date, ...data });
  },
};