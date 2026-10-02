const mongoose = require("mongoose");
const hiddenRecentFoodDao = require("./hidden-recent-food-dao");

module.exports = {
  // Lo usa diets/diet-model.js para filtrar el cálculo de recientes. Con un
  // id o una posición inválidos no hay nada oculto (el cálculo ya devuelve []).
  async listForMeal(userId, mealIndex, kind) {
    const index = Number.parseInt(String(mealIndex ?? 0), 10);
    if (!mongoose.isValidObjectId(userId) || !Number.isInteger(index) || index < 0) {
      return [];
    }
    return hiddenRecentFoodDao.listForMeal(userId, index, kind);
  },

  async hide(userId, { mealIndex, kind, ids, all }) {
    const hiddenAt = new Date();
    if (all) {
      await hiddenRecentFoodDao.hideAll(userId, mealIndex, kind, hiddenAt);
    } else {
      await hiddenRecentFoodDao.hideItems(userId, mealIndex, kind, ids, hiddenAt);
    }
    return { success: true };
  },

  async restore(userId, { mealIndex, kind, ids }) {
    await hiddenRecentFoodDao.restoreItems(userId, mealIndex, kind, ids);
    return { success: true };
  },
};
