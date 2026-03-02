const recipeModel = require("./recipe-model");
const userModel = require("../users/model");

const controller = {
  async getRecipeById(req, res, next) {
    try {
      const recipe = await recipeModel.getRecipeById(req.params.id);
      if (!recipe) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      return res.json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async searchRecipes(req, res, next) {
    try {
      const page = parseInt((req.query.page || 0).toString(), 10);
      const limit = parseInt((req.query.limit || 10).toString(), 10);
      const search = req.query.search || req.body.search || "";
      const userId = req.user.id;

      const recipes = await recipeModel.searchRecipes(
        page,
        limit,
        search,
        userId,
      );
      return res.json(recipes);
    } catch (error) {
      next(error);
    }
  },

  async getUserRecipes(req, res, next) {
    try {
      const page = parseInt((req.query.page || 0).toString(), 10);
      const limit = parseInt((req.query.limit || 20).toString(), 10);
      const userId = req.user.id;

      const recipes = await recipeModel.getUserRecipes(userId, page, limit);
      return res.json(recipes);
    } catch (error) {
      next(error);
    }
  },

  async getVerifiedRecipes(req, res, next) {
    try {
      const page = parseInt((req.query.page || 0).toString(), 10);
      const limit = parseInt((req.query.limit || 20).toString(), 10);
      const search = req.query.search || "";

      const recipes = await recipeModel.getVerifiedRecipes(page, limit, search);
      return res.json(recipes);
    } catch (error) {
      next(error);
    }
  },

  async getFavoriteRecipes(req, res, next) {
    try {
      const page = parseInt((req.query.page || 0).toString(), 10);
      const limit = parseInt((req.query.limit || 20).toString(), 10);
      const search = req.query.search || "";
      const userId = req.user.id;

      const recipes = await recipeModel.getFavoriteRecipes(
        userId,
        page,
        limit,
        search,
      );
      return res.json(recipes);
    } catch (error) {
      next(error);
    }
  },

  async createRecipe(req, res, next) {
    try {
      const recipe = await recipeModel.createRecipe({
        name: req.body.name,
        description: req.body.description,
        customProducts: req.body.customProducts || [],
        userId: req.user.id,
        verified: false,
      });
      return res.status(201).json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async composeRecipe(req, res, next) {
    try {
      const result = await recipeModel.composeRecipe(req.body, req.user.id);
      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },

  async updateRecipe(req, res, next) {
    try {
      // Verify ownership
      const existing = await recipeModel.getRecipeById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      if (existing.userId?.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Cannot edit recipes you don't own" });
      }

      const updateData = {};
      if (req.body.name !== undefined) updateData.name = req.body.name;
      if (req.body.description !== undefined)
        updateData.description = req.body.description;
      if (req.body.customProducts !== undefined)
        updateData.customProducts = req.body.customProducts;

      const recipe = await recipeModel.updateRecipe(req.params.id, updateData);
      return res.json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async deleteRecipe(req, res, next) {
    try {
      // Verify ownership
      const existing = await recipeModel.getRecipeById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      if (existing.userId?.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Cannot delete recipes you don't own" });
      }

      await recipeModel.deleteRecipe(req.params.id);
      return res.json({ message: "Recipe deleted successfully" });
    } catch (error) {
      next(error);
    }
  },

  async toggleFavoriteRecipe(req, res, next) {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      const result = await recipeModel.toggleFavoriteRecipe(userId, recipeId);
      return res.json({
        isFavorite: result.isFavorite,
        message: result.isFavorite
          ? "Recipe added to favorites"
          : "Recipe removed from favorites",
      });
    } catch (error) {
      next(error);
    }
  },

  async addRecipeCustomProduct(req, res, next) {
    try {
      const recipe = await recipeModel.addRecipeCustomProduct(
        req.params.idRecipe,
        req.params.idCustomProduct,
      );
      return res.json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async removeRecipeCustomProduct(req, res, next) {
    try {
      const recipe = await recipeModel.removeRecipeCustomProduct(
        req.params.idRecipe,
        req.params.idCustomProduct,
      );
      return res.json(recipe);
    } catch (error) {
      next(error);
    }
  },
};

module.exports = controller;
