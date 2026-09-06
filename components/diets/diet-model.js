const dietDao = require('./diet-dao');

// Capa de compatibilidad — ver cabecera de diet-dao.js.
module.exports = {
  async getDietById(id) {
    return dietDao.getDietById(id);
  },

  async getRecentMealProducts(id, options) {
    return dietDao.getRecentMealProducts(id, options);
  },

  async getRecentMealRecipes(id, options) {
    return dietDao.getRecentMealRecipes(id, options);
  },

  async addDietDietDay(idDiet) {
    return dietDao.addDietDietDay(idDiet);
  },

  async updatePinnedNote(id, notes) {
    return dietDao.updatePinnedNote(id, notes);
  },
};
