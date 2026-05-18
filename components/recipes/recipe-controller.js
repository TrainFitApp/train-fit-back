const recipeModel = require("./recipe-model");
const featureAccessService = require("../billing/feature-access-service");

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return !!value;
}

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
      const filters = {
        ownOnly: toBoolean(req.query.own || req.body.own),
        favoritesOnly: toBoolean(req.query.fav || req.body.fav),
        verifiedOnly: toBoolean(req.query.verified || req.body.verified),
      };

      const recipes = await recipeModel.searchRecipes(
        page,
        limit,
        search,
        userId,
        filters,
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
      const search = req.query.search || "";
      const userId = req.user.id;

      const recipes = await recipeModel.getUserRecipes(userId, page, limit, search);
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

  async getArchivedRecipes(req, res, next) {
    try {
      const page = parseInt((req.query.page || 0).toString(), 10);
      const limit = parseInt((req.query.limit || 20).toString(), 10);
      const search = req.query.search || "";
      const userId = req.user.id;

      const recipes = await recipeModel.getArchivedRecipes(
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
      const ownRecipesCount = await recipeModel.countByUserId(req.user.id);
      if (!featureAccessService.canCreateRecipe(req.user, ownRecipesCount)) {
        return res.status(403).json({
          code: "PREMIUM_LIMIT_RECIPES",
          message: "L\u00edmite Free alcanzado. Solo puedes crear 2 recetas propias.",
        });
      }

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
      const isCreatingNewRecipe = !req.body?.recipeId && !!req.body?.recipe;
      if (isCreatingNewRecipe) {
        const ownRecipesCount = await recipeModel.countByUserId(req.user.id);
        if (!featureAccessService.canCreateRecipe(req.user, ownRecipesCount)) {
          return res.status(403).json({
            code: "PREMIUM_LIMIT_RECIPES",
            message:
              "L\u00edmite Free alcanzado. Solo puedes crear 2 recetas propias.",
          });
        }
      }

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

  async toggleArchivedRecipe(req, res, next) {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      const result = await recipeModel.toggleArchivedRecipe(userId, recipeId);
      return res.json({
        isArchived: result.isArchived,
        isFavorite: result.isArchived,
        message: result.isArchived ? "Recipe archived" : "Recipe unarchived",
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
