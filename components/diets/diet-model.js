const dietDao = require('./diet-dao');

module.exports = {
  
  async getDiets(page, limit) {
    return dietDao.getDiets(page, limit);
  },

  async getDietById(id) {
    return dietDao.getDietById(id);
  },

  async getSearchDiets(page, limit, search) {
    return dietDao.getSearchDiets(page, limit, search);
  },

  async createDiet(diet) {
    return dietDao.createDiet(diet);
  },

  async addDietDietDay(idDiet, idDietDay) {
    return dietDao.addDietDietDay(idDiet, idDietDay);
  },

  async addDietUser(idUser, idDiet) {
    return dietDao.addDietUser(idUser, idDiet);
  },

  async updateDiet(id, { name, dietDays }) {
    return dietDao.updateUser(id, { name, dietDays });
  },

  async deleteDiet(id) {
    return dietDao.deleteDiet(id);
  },

  async deleteDietDietDay(idDietDay, idDiet) {
    return dietDao.deleteDietDietDay(idDietDay, idDiet);
  }

};