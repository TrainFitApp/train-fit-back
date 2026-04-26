const customRecipeModel = require("./custom-recipe-model");
const recipeMergeService = require("../recipes/recipe-merge.service");

const controller = {
  async getCustomRecipeById(req, res) {
    const customRecipe = await customRecipeModel.getCustomRecipeById(req.params.id);
    if (!customRecipe) {
      return res.status(404).json({ message: "CustomRecipe not found" });
    }

    const merged = await recipeMergeService.getMergedRecipeData(customRecipe);
    return res.send({ ...customRecipe.toObject(), merged });
  },

  async searchCustomRecipes(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const recipes = await customRecipeModel.searchCustomRecipe(
      page,
      limit,
      req.body.search,
    );
    return res.send(recipes);
  },

  async createCustomRecipe(req, res) {
    const customRecipe = await customRecipeModel.createCustomRecipe(req.body);
    const merged = await recipeMergeService.getMergedRecipeData(customRecipe);
    return res.status(201).send({ ...customRecipe.toObject(), merged });
  },

  async update(req, res) {
    const customRecipe = await customRecipeModel.update(req.params.id, req.body);
    const merged = await recipeMergeService.getMergedRecipeData(customRecipe);
    return res.send({ ...customRecipe.toObject(), merged });
  },

  async delete(req, res) {
    await customRecipeModel.delete(req.params.id);
    return res.sendStatus(204);
  },
};

module.exports = controller;
