const customRecipeDao = require("./custom-recipe-dao");

module.exports = {
  async getCustomRecipeById(id) {
    return customRecipeDao.getCustomRecipeById(id);
  },

  async createCustomRecipe(customRecipe, dietDay, meal, idDietInUse,idUser) {
    return customRecipeDao.createCustomRecipe(customRecipe, dietDay, meal, idDietInUse,idUser);
  },

  async createNewCustomRecipe(idUser, idMeal, customRecipe) {
    return customRecipeDao.createNewCustomRecipe(idUser, idMeal, customRecipe);
  },

  async searchCustomRecipe(page, limit, search) {
    return customRecipeDao.searchCustomRecipe(page, limit, search);
  },

  async update(customRecipe) {
    return customRecipeDao.update(customRecipe);
  },

  async addCustomRecipeCustomProduct(idCustomRecipe, customProduct) {
    return customRecipeDao.addCustomRecipeCustomProduct(
      idCustomRecipe,
      customProduct
    );
  },

  // async deleteCustomRecipeCustomProduct(idCustomRecipe, idCustomProduct) {
  //   return customRecipeDao.deleteCustomRecipeCustomProduct(idCustomRecipe, idCustomProduct);
  // },

  async delete(id) {
    return customRecipeDao.delete(id);
  },
};
