const customRecipeDao = require("./custom-recipe-dao");

module.exports = {
  async getCustomRecipeById(id) {
    return customRecipeDao.getCustomRecipeById(id);
  },

  async createCustomRecipe(customRecipe) {
    return customRecipeDao.createCustomRecipe(customRecipe);
  },

  async searchCustomRecipe(page, limit, search) {
    return customRecipeDao.searchCustomRecipe(page, limit, search);
  },

  async update(id, customRecipe) {
    return customRecipeDao.update(id, customRecipe);
  },

  async delete(id) {
    return customRecipeDao.delete(id);
  },
};
