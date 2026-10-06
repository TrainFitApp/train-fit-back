const favoritesDao = require("../favorites/favorites-dao");
const recipeSchema = require("./recipe-schema");
const dietDaySchema = require("../dietDays/diet-days-schema");
const MealSnippet = require("../mealSnippets/meal-snippet-schema");
const DietTemplate = require("../dietTemplates/diet-template-schema");
const DietPhase = require("../dietPhases/diet-phase-schema");
const mongoose = require("mongoose");
const {
  RECIPE_SEARCH_CONFIG,
  parseSearchQuery,
  searchByRelevance,
  listByScope,
} = require("../util/food-search");

// Las recetas de `ids` que alguien tiene en un plato: diario (también en las
// alternativas de una comida), comida guardada, plantilla o fase de dieta.
async function usedRecipeIds(ids) {
  const inIds = { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) };
  const lists = await Promise.all([
    dietDaySchema.distinct("meals.customRecipes.recipe", { "meals.customRecipes.recipe": inIds }),
    dietDaySchema.distinct("meals.alternatives.customRecipes.recipe", { "meals.alternatives.customRecipes.recipe": inIds }),
    MealSnippet.distinct("customRecipes.recipe", { "customRecipes.recipe": inIds }),
    DietTemplate.distinct("menus.meals.alternatives.customRecipes.recipe", { "menus.meals.alternatives.customRecipes.recipe": inIds }),
    DietPhase.distinct("contents.menus.meals.alternatives.customRecipes.recipe", {
      "contents.menus.meals.alternatives.customRecipes.recipe": inIds,
    }),
  ]);
  const wanted = new Set(ids.map(String));
  return [...new Set(lists.flat().map(String))].filter((id) => wanted.has(id));
}

async function orphanRecipes(ids) {
  if (!ids.length) return;
  await recipeSchema.updateMany({ _id: { $in: ids } }, { $unset: { userId: "" }, $set: { verified: false }, $inc: { __v: 1 } });
}

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  // Las recetas puestas en platos guardan modificaciones contra ingredientes
  // concretos de la receta (por su _id): si un ingrediente desaparece de la
  // receta, sus modificaciones y "quitados" se descartan en todas partes
  // (diarios, comidas guardadas, plantillas y fases), de una vez y en el servidor.
  async rebaseCustomRecipesForRecipe(recipeId, validBaseCustomProductIds = []) {
    const recipeObjectId = new mongoose.Types.ObjectId(String(recipeId));
    const validIds = validBaseCustomProductIds
      .map((id) => String(id?._id || id || "") || null)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));
    const pulls = (prefix) => ({
      $pull: {
        [`${prefix}.modifiedBaseCustomProducts`]: { baseCustomProductId: { $nin: validIds } },
        [`${prefix}.removedBaseCustomProductIds`]: { $nin: validIds },
      },
      $inc: { __v: 1 },
    });
    const arrayFilters = [{ "cr.recipe": recipeObjectId }];
    await dietDaySchema.updateMany(
      { "meals.customRecipes.recipe": recipeObjectId },
      pulls("meals.$[].customRecipes.$[cr]"),
      { arrayFilters },
    );
    await MealSnippet.updateMany({ "customRecipes.recipe": recipeObjectId }, pulls("customRecipes.$[cr]"), { arrayFilters });
    await DietTemplate.updateMany(
      { "menus.meals.alternatives.customRecipes.recipe": recipeObjectId },
      pulls("menus.$[].meals.$[].alternatives.$[].customRecipes.$[cr]"),
      { arrayFilters },
    );
    await DietPhase.updateMany(
      { "contents.menus.meals.alternatives.customRecipes.recipe": recipeObjectId },
      pulls("contents.$[].menus.$[].meals.$[].alternatives.$[].customRecipes.$[cr]"),
      { arrayFilters },
    );
  },

  async countByUserId(userId) {
    return recipeSchema.countDocuments({ userId });
  },

  // ¿Está la receta en el diario del usuario (alguna CustomRecipe suya que la
  // use)? Para que siga pudiendo abrir una receta privada que tiene anotada
  // aunque ya no la vea por otra vía.
  async isRecipeInUserDiary(recipeId, userId) {
    return Boolean(await dietDaySchema.exists({ userId, "meals.customRecipes.recipe": recipeId }));
  },

  // ¿La usa alguien en un plato?
  async isRecipeInUse(recipeId) {
    return (await usedRecipeIds([recipeId])).length > 0;
  },

  async isRecipeFavoriteOf(recipeId, userId) {
    return favoritesDao.includes(userId, "recipes", recipeId);
  },

  async getRecipeById(id) {
    return recipeSchema.findById(id);
  },

  // Los derivados de búsqueda los pone el schema (hook pre-save).
  async insert(recipe) {
    return recipeSchema.create(recipe);
  },

  async findCustomProducts(id) {
    return recipeSchema.findById(id).select("customProducts").lean();
  },

  async update(id, set) {
    return recipeSchema.findByIdAndUpdate(id, { $set: set, $inc: { __v: 1 } }, { new: true });
  },

  async deleteById(id) {
    return recipeSchema.findByIdAndDelete(id);
  },

  // Borrado de cuenta (recipe-schema.js, cuando ya no existe el contenido de
  // la propia cuenta): sus recetas salen de todas las favoritas y las que
  // otros tienen en un plato se quedan huérfanas. Las demás las borra la
  // cascada.
  async releaseOwnRecipes(userId) {
    const ids = await recipeSchema.find({ userId }).distinct("_id");
    if (!ids.length) return;
    await favoritesDao.removeEverywhere("recipes", ids);
    await orphanRecipes(await usedRecipeIds(ids));
  },

  // Sin dueño ni verificar (la búsqueda no las enseña a nadie, pero los
  // platos que las usan se siguen pintando).
  orphan: (ids) => orphanRecipes(ids),

  /**
   * Búsqueda de recetas (/api/recipes/search y las vistas de propias,
   * verificadas y favoritas). Mismo motor que los productos:
   * components/util/food-search.js. Aquí solo se decide la visibilidad.
   */
  async searchRecipes(page, limit, search, userId, filters = {}) {
    const ownOnly = !!filters.ownOnly;
    const favoritesOnly = !!filters.favoritesOnly;
    const verifiedOnly = !!filters.verifiedOnly;
    const tagsFilter = Array.isArray(filters.tags)
      ? filters.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const userObjectId = toObjectId(userId);
    const { hasSearch } = parseSearchQuery(search);

    if ((ownOnly || favoritesOnly) && !userObjectId) return [];

    let favoriteIds = [];
    if (favoritesOnly) {
      favoriteIds = await favoritesDao.list(userObjectId, "recipes");
      if (!favoriteIds.length) return [];
    }

    const scope = {};

    if (ownOnly) {
      scope.userId = userObjectId;
      if (verifiedOnly) scope.verified = true;
    } else if (verifiedOnly) {
      scope.verified = true;
    } else if (userObjectId) {
      // Las verificadas las ve todo el mundo; las propias, solo su dueño.
      scope.$or = [{ verified: true }, { userId: userObjectId }];
    } else {
      scope.verified = true;
    }

    // Con favoritos, el conjunto de ids basta (como hace meal-dao con los
    // productos): una receta que el usuario pudo marcar como favorita (p. ej.
    // la que le pautó su entrenador, que no es verificada ni suya) tiene que
    // salir en sus favoritas. Solo se marcan las que el usuario puede leer
    // (favorites-service.js).
    if (favoritesOnly) {
      delete scope.$or;
      scope._id = { $in: favoriteIds };
    }

    // TASK-046 — las etiquetas acotan igual con búsqueda y sin ella.
    if (tagsFilter.length) {
      scope.tags = { $in: tagsFilter };
    }

    const config = {
      ...RECIPE_SEARCH_CONFIG,
      // Sin índice de texto no hay etapa de rescate por stemming, pero el
      // motor lo detectaría solo al fallar la query; declararlo evita la
      // llamada inútil si algún día se quita el índice de recetas.
      hasTextIndex: true,
    };

    if (!hasSearch) {
      return listByScope({
        model: recipeSchema,
        scope,
        page,
        limit,
        config,
      });
    }

    return searchByRelevance({
      model: recipeSchema,
      scope,
      search,
      page,
      limit,
      context: { ownerId: userObjectId, favoriteIds: new Set(favoriteIds.map(String)) },
      config,
    });
  },

  async getUserRecipes(userId, page, limit, search = "") {
    return this.searchRecipes(page, limit, search, userId, {
      ownOnly: true,
    });
  },

  async getVerifiedRecipes(page, limit, search) {
    return this.searchRecipes(page, limit, search, null, {
      verifiedOnly: true,
    });
  },

  async pullCustomProduct(idRecipe, idCustomProduct) {
    return recipeSchema.findByIdAndUpdate(
      idRecipe,
      { $pull: { customProducts: { _id: idCustomProduct } }, $inc: { __v: 1 } },
      { new: true },
    );
  },
};
