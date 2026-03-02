const dataRecipeDao = require("./data-recipe-dao");

module.exports = {
  async getById(id) {
    return dataRecipeDao.getById(id);
  },

  async create(dataRecipe, mealId) {
    return dataRecipeDao.create(dataRecipe, mealId);
  },

  async update(id, data) {
    return dataRecipeDao.update(id, data);
  },

  async delete(id, mealId) {
    return dataRecipeDao.delete(id, mealId);
  },

  async searchRecipes(page, limit, search, userId) {
    return dataRecipeDao.searchRecipes(page, limit, search, userId);
  },

  async getUserRecipes(userId, page, limit) {
    return dataRecipeDao.getUserRecipes(userId, page, limit);
  },
};
