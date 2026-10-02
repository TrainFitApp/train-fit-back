const recipeModel = require("./recipe-model");
const featureAccessService = require("../billing/feature-access-service");

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return !!value;
}

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function isTrainer(req) {
  return Boolean(req.userData?.roles?.includes("trainer"));
}

// TASK-046 — acepta tags como array (?tags=a&tags=b) o CSV (?tags=a,b).
function parseTags(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

// Los ingredientes de una receta solo los cambia su dueño (o un admin), como
// en updateRecipe. Antes cualquiera tocaba recetas ajenas o verificadas.
async function rejectIfNotRecipeOwner(req, res, recipeId) {
  const recipe = await recipeModel.getRecipeById(recipeId);
  if (!recipe) {
    res.status(404).json({ message: "Recipe not found" });
    return true;
  }
  if (!isAdmin(req) && recipe.userId?.toString() !== req.user.id) {
    res.status(403).json({ message: "Cannot edit recipes you don't own" });
    return true;
  }
  return false;
}

const controller = {
  async getRecipeById(req, res, next) {
    try {
      const recipe = await recipeModel.getRecipeById(req.params.id);
      // Una receta privada que no puede ver responde igual que una que no
      // existe: no confirma ni su existencia.
      if (!recipe || !(isAdmin(req) || (await recipeModel.canUserReadRecipe(recipe, req.user.id)))) {
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
        tags: parseTags(req.query.tags || req.body.tags),
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
      if (!isAdmin(req)) {
        const ownRecipesCount = await recipeModel.countByUserId(req.user.id);
        if (!featureAccessService.canCreateRecipe(req.user, ownRecipesCount)) {
          return res.status(403).json({
            code: "PREMIUM_LIMIT_RECIPES",
            message: "L\u00edmite Free alcanzado. Solo puedes crear 2 recetas propias.",
          });
        }
      }

      const isDefault = isAdmin(req) && req.body.verified === true;
      const recipe = await recipeModel.createRecipe({
        name: req.body.name,
        description: req.body.description,
        customProducts: req.body.customProducts || [],
        tags: parseTags(req.body.tags),
        userId: isDefault ? undefined : req.user.id,
        verified: isDefault ? true : false,
      });
      return res.status(201).json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async composeRecipe(req, res, next) {
    try {
      const isCreatingNewRecipe = !req.body?.recipeId && !!req.body?.recipe;
      const trainer = isTrainer(req) && !isAdmin(req);

      // Un trainer solo puede usar este endpoint para crear una receta
      // nueva y standalone para su propia biblioteca (mismo caso que
      // RecipeBuilderModalComponent en apps/train-fit-trainers). Nunca para
      // adjuntarla a un meal/diet day ajeno v\u00eda recipeId/context \u2014 ese es
      // el mismo endpoint que usa "user" para su propia dieta, y
      // recipeDao.composeRecipe no verifica ah\u00ed que context.mealId
      // pertenezca a quien llama.
      if (trainer && (req.body?.recipeId || req.body?.context)) {
        return res.status(403).json({
          message: "Trainers can only create standalone recipes via this endpoint",
        });
      }

      // L\u00edmite Free de 2 recetas: es una regla del modelo de negocio del
      // cliente final (featureAccessService), no aplica a la biblioteca
      // profesional de un entrenador.
      if (isCreatingNewRecipe && !isAdmin(req) && !trainer) {
        const ownRecipesCount = await recipeModel.countByUserId(req.user.id);
        if (!featureAccessService.canCreateRecipe(req.user, ownRecipesCount)) {
          return res.status(403).json({
            code: "PREMIUM_LIMIT_RECIPES",
            message:
              "L\u00edmite Free alcanzado. Solo puedes crear 2 recetas propias.",
          });
        }
      }

      const result = await recipeModel.composeRecipe(req.body, req.user.id, isAdmin(req));
      return res.status(201).json(result);
    } catch (error) {
      // La comida destino no es suya o está pautada (recipe-dao.js#
      // assertComposeMealContext): mismas respuestas que meal-controller.
      if (error.code === "MEAL_NOT_FOUND") {
        return res.status(400).json({ message: error.message, code: error.code });
      }
      if (error.code === "MEAL_PROTECTED") {
        return res.status(403).json({ message: error.message, code: error.code });
      }
      next(error);
    }
  },

  async updateRecipe(req, res, next) {
    try {
      const existing = await recipeModel.getRecipeById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      if (!isAdmin(req) && existing.userId?.toString() !== req.user.id) {
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
      if (req.body.tags !== undefined) updateData.tags = parseTags(req.body.tags);

      const recipe = await recipeModel.updateRecipe(req.params.id, updateData);
      return res.json(recipe);
    } catch (error) {
      next(error);
    }
  },

  async deleteRecipe(req, res, next) {
    try {
      const existing = await recipeModel.getRecipeById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      if (!isAdmin(req) && existing.userId?.toString() !== req.user.id) {
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

  // TAREA5 — favoritos son la biblioteca personal del ENTRENADOR (los
  // alimentos que suele recomendar), no del cliente que esté viendo en ese
  // momento — por eso sigue usando req.user.id (el autenticado real) igual
  // que para el consumidor, solo se amplía el rol permitido en la ruta.
  async toggleArchivedRecipe(req, res, next) {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      // Solo se marca como favorita una receta que el usuario puede leer
      // (las favoritas se listan por id, sin más filtro). Quitarla siempre se
      // puede: una favorita ya cuenta como legible.
      if (!isAdmin(req)) {
        const recipe = await recipeModel.getRecipeById(recipeId);
        if (!recipe || !(await recipeModel.canUserReadRecipe(recipe, userId))) {
          return res.status(404).json({ message: "Recipe not found" });
        }
      }

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
      if (await rejectIfNotRecipeOwner(req, res, req.params.idRecipe)) return;
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
      if (await rejectIfNotRecipeOwner(req, res, req.params.idRecipe)) return;
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
