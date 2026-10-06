const recentFoodDao = require("./recent-food-dao");

const MAX_LIMIT = 15;

module.exports = {
  // Recientes de la comida `mealIndex` (Desayuno = 0…) de `userId`, sin los
  // que haya ocultado.
  async listProducts(userId, { mealIndex, limit }) {
    const hidden = await recentFoodDao.listHidden(userId, mealIndex, "product");
    return recentFoodDao.listRecentProducts(userId, mealIndex, Math.min(limit || MAX_LIMIT, MAX_LIMIT), hidden);
  },

  async listRecipes(userId, { mealIndex, limit }) {
    const hidden = await recentFoodDao.listHidden(userId, mealIndex, "recipe");
    return recentFoodDao.listRecentRecipes(userId, mealIndex, Math.min(limit || MAX_LIMIT, MAX_LIMIT), hidden);
  },

  async hide(userId, { mealIndex, kind, ids, all }) {
    const hiddenAt = new Date();
    if (all) await recentFoodDao.hideAll(userId, mealIndex, kind, hiddenAt);
    else await recentFoodDao.hideItems(userId, mealIndex, kind, ids, hiddenAt);
    return { success: true };
  },

  async restore(userId, { mealIndex, kind, ids }) {
    await recentFoodDao.restoreItems(userId, mealIndex, kind, ids);
    return { success: true };
  },
};
