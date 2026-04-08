const recipeDao = require("./recipe-dao");

module.exports = {
  async countByUserId(userId) {
    return recipeDao.countByUserId(userId);
  },

  async getRecipeById(id) {
    return recipeDao.getRecipeById(id);
  },

  async createRecipe(recipe) {
    return recipeDao.createRecipe(recipe);
  },

  async updateRecipe(id, recipe) {
    return recipeDao.updateRecipe(id, recipe);
  },

  async deleteRecipe(id) {
    return recipeDao.deleteRecipe(id);
  },

  async searchRecipes(page, limit, search, userId) {
    return recipeDao.searchRecipes(page, limit, search, userId);
  },

  async getUserRecipes(userId, page, limit) {
    return recipeDao.getUserRecipes(userId, page, limit);
  },

  async getVerifiedRecipes(page, limit, search) {
    return recipeDao.getVerifiedRecipes(page, limit, search);
  },

  async getArchivedRecipes(userId, page, limit, search) {
    return recipeDao.getArchivedRecipes(userId, page, limit, search);
  },

  async toggleArchivedRecipe(userId, recipeId) {
    return recipeDao.toggleArchivedRecipe(userId, recipeId);
  },

  async addRecipeCustomProduct(idRecipe, idCustomProduct) {
    return recipeDao.addRecipeCustomProduct(idRecipe, idCustomProduct);
  },

  async removeRecipeCustomProduct(idRecipe, idCustomProduct) {
    return recipeDao.removeRecipeCustomProduct(idRecipe, idCustomProduct);
  },

  async composeRecipe(payload, userId) {
    return recipeDao.composeRecipe(payload, userId);
  },
};
