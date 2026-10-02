const dietDao = require('./diet-dao');
const hiddenRecentFoodService = require('../hiddenRecentFoods/hidden-recent-food-service');

// Capa de compatibilidad — ver cabecera de diet-dao.js.
module.exports = {
  async getDietById(id) {
    return dietDao.getDietById(id);
  },

  // El id es el del propio usuario (ver diet-dao.js), que es también el
  // dueño de sus recientes ocultos.
  async getRecentMealProducts(id, options) {
    const hidden = await hiddenRecentFoodService.listForMeal(id, options.mealIndex, 'product');
    return dietDao.getRecentMealProducts(id, { ...options, hidden });
  },

  async getRecentMealRecipes(id, options) {
    const hidden = await hiddenRecentFoodService.listForMeal(id, options.mealIndex, 'recipe');
    return dietDao.getRecentMealRecipes(id, { ...options, hidden });
  },

  async addDietDietDay(idDiet) {
    return dietDao.addDietDietDay(idDiet);
  },

  async updatePinnedNote(id, notes) {
    return dietDao.updatePinnedNote(id, notes);
  },
};
