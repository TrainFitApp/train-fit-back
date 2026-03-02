const customRecipeModel = require("./custom-recipe-model");

const controller = {
  async getCustomRecipeById(req, res) {
    const recipe = await customRecipeModel.getCustomRecipeById(req.params.id);

    return res.send(recipe);
  },

  async searchCustomRecipes(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const recipes = await customRecipeModel.searchCustomRecipe(
      page,
      limit,
      req.body.search
    );
    return res.send(recipes);
  },

  async createCustomRecipe(req, res) {
    const customRecipeOrDietDay = await customRecipeModel.createCustomRecipe(
      req.body.customRecipe,
      req.body.dietDay,
      req.body.meal,
      req.body.idDietInUse,
      req.body.idUser
    );

    return res.send(customRecipeOrDietDay);
  },

  async createNewCustomRecipe(req, res) {
    const newCustomRecipe = await customRecipeModel.createNewCustomRecipe(
      req.params.idUser,
      req.params.idMeal,
      req.body
    );
    return res.send(newCustomRecipe);
  },

  async update(req, res) {
    const customRecipe = await customRecipeModel.update(
      req.body
    );
    return res.send(customRecipe);
  },

  async addCustomRecipeCustomProduct(req, res) {
    const customRecipe = await customRecipeModel.addCustomRecipeCustomProduct(
      req.params.idCustomRecipe,
      req.body
    );
    return res.send(customRecipe);
  },

  // async deleteCustomRecipeCustomProduct(req, res) {
  //   const recipe = await customRecipeModel.deleteCustomRecipeCustomProduct(req.params.idCustomRecipe, req.params.idCustomProduct);
  //   return res.send(recipe);
  // },

  async delete(req, res) {
    await customRecipeModel.delete(req.params.id);
    return res.sendStatus(204);
  },
};

module.exports = controller;
