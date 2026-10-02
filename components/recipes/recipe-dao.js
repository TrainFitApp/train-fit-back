// const dayStepSchema = require("./schema");
// const userSchema = require("../users/schema");
const recipeSchema = require("./recipe-schema");
const userSchema = require("../users/schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const mealSchema = require("../meals/meal-schema");

const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const mealModel = require("../meals/meal-service");
const dietDayDao = require("../dietDays/diet-days-dao");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");
const recipeMergeService = require("./recipe-merge.service");

const customProductSchema = require("../customProducts/custom-product-schema");
const mongoose = require("mongoose");
const {
  RECIPE_SEARCH_CONFIG,
  parseSearchQuery,
  searchByRelevance,
  listByScope,
} = require("../util/food-search");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  hasOwn(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
  },

  areCustomProductValuesEqual(left, right, epsilon = 1e-9) {
    if (left === right) return true;
    if (typeof left === "number" && typeof right === "number") {
      return Math.abs(left - right) < epsilon;
    }
    return false;
  },

  normalizeCustomProductId(value) {
    const normalizedValue = value?._id || value;
    return normalizedValue?.toString?.() || null;
  },

  getModifiedBaseCustomProductId(value) {
    const baseValue = value?.baseCustomProductId || value?.customProductId;
    return this.normalizeCustomProductId(baseValue);
  },

  buildCustomProductPayload(cpData) {
    return recipeMergeService.sanitizeCustomProductData(cpData, {
      includeProduct: true,
      includeId: true,
    });
  },

  buildCustomProductUpdateQuery(currentCustomProduct, cpData) {
    const $set = {};
    const $unset = {};
    const overrideFields = recipeMergeService.CUSTOM_PRODUCT_OVERRIDE_FIELDS.filter(
      (field) => field !== "quantity",
    );

    Object.keys(cpData || {}).forEach((key) => {
      if (key === "_id") return;
      if (overrideFields.includes(key)) return;
      $set[key] = cpData[key];
    });

    overrideFields.forEach((field) => {
      if (!this.hasOwn(cpData, field)) {
        $unset[field] = "";
        return;
      }

      const value = cpData[field];
      const baseValue = currentCustomProduct?.product?.[field];

      if (value === undefined) {
        $unset[field] = "";
        return;
      }

      if (typeof value === "string" && value.trim() === "") {
        $unset[field] = "";
        return;
      }

      if (value === null) {
        $set[field] = null;
        return;
      }

      if (this.areCustomProductValuesEqual(value, baseValue)) {
        $unset[field] = "";
        return;
      }

      $set[field] = value;
    });

    const updateQuery = {};
    if (Object.keys($set).length) updateQuery.$set = $set;
    if (Object.keys($unset).length) updateQuery.$unset = $unset;
    return updateQuery;
  },

  async syncRecipeCustomProducts(nextCustomProducts, currentCustomProductIds = []) {
    const normalizedNextProducts = (nextCustomProducts || []).map((cpData) =>
      this.buildCustomProductPayload(cpData),
    );

    const currentIds = (currentCustomProductIds || [])
      .map((id) => this.normalizeCustomProductId(id))
      .filter(Boolean);
    const currentCustomProducts = currentIds.length
      ? await customProductSchema.find({ _id: { $in: currentIds } })
      : [];
    const currentCustomProductMap = new Map(
      currentCustomProducts.map((customProduct) => [
        customProduct._id.toString(),
        customProduct,
      ]),
    );
    const nextIds = [];

    for (const cpData of normalizedNextProducts) {
      const existingId = this.normalizeCustomProductId(cpData._id);
      delete cpData._id;

      if (existingId && currentIds.includes(existingId)) {
        const currentCustomProduct = currentCustomProductMap.get(existingId);
        const updateQuery = this.buildCustomProductUpdateQuery(
          currentCustomProduct,
          cpData,
        );

        if (Object.keys(updateQuery).length > 0) {
          await customProductSchema.findByIdAndUpdate(existingId, updateQuery);
        }

        nextIds.push(existingId);
        continue;
      }

      const createdCP = await customProductSchema.create(cpData);
      nextIds.push(createdCP._id.toString());
    }

    const removedIds = currentIds.filter((id) => !nextIds.includes(id));
    if (removedIds.length > 0) {
      await customProductSchema.deleteMany({ _id: { $in: removedIds } });
    }

    return nextIds;
  },

  async rebaseCustomRecipesForRecipe(recipeId, validBaseCustomProductIds = []) {
    const validIds = new Set(
      validBaseCustomProductIds
        .map((id) => this.normalizeCustomProductId(id))
        .filter(Boolean),
    );
    const customRecipes = await customRecipeSchema.find({ recipe: recipeId });

    for (const customRecipe of customRecipes) {
      const removedModifiedIds = [];
      const nextModified = (customRecipe.modifiedBaseCustomProducts || []).filter((item) => {
        const baseId = this.getModifiedBaseCustomProductId(item);
        const keep = !!baseId && validIds.has(baseId);
        if (!keep) {
          const customProductId = this.normalizeCustomProductId(item);
          if (customProductId) removedModifiedIds.push(customProductId);
        }
        return keep;
      });
      const nextRemoved = (customRecipe.removedBaseCustomProductIds || []).filter((item) => {
        const baseId = item?._id || item;
        return !!baseId && validIds.has(baseId.toString());
      });

      if (
        nextModified.length !== (customRecipe.modifiedBaseCustomProducts || []).length ||
        nextRemoved.length !== (customRecipe.removedBaseCustomProductIds || []).length
      ) {
        customRecipe.modifiedBaseCustomProducts = nextModified
          .map((item) => this.normalizeCustomProductId(item))
          .filter(Boolean);
        customRecipe.removedBaseCustomProductIds = nextRemoved;
        await customRecipe.save();
      }

      if (removedModifiedIds.length > 0) {
        await customProductSchema.deleteMany({ _id: { $in: removedModifiedIds } });
      }
    }
  },

  async countByUserId(userId) {
    return recipeSchema.countDocuments({ userId });
  },

  async getRecipeById(id) {
    return new Promise((resolve, reject) =>
      recipeSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async createRecipe(recipe) {
    try {
      recipe.customProducts = await this.syncRecipeCustomProducts(
        recipe.customProducts || [],
      );
      // Los derivados de búsqueda los pone el schema (hook pre-save).
      return await recipeSchema.create(recipe);
    } catch (err) {
      throw err;
    }
  },

  async updateRecipe(id, recipe) {
    try {
      const currentRecipe = await recipeSchema
        .findById(id)
        .select("customProducts")
        .setOptions({ autopopulate: false });
      if (!currentRecipe) {
        throw new Error("Recipe not found");
      }

      if (recipe.customProducts !== undefined) {
        recipe.customProducts = await this.syncRecipeCustomProducts(
          recipe.customProducts,
          currentRecipe.customProducts || [],
        );
        await this.rebaseCustomRecipesForRecipe(id, recipe.customProducts);
      }

      return await recipeSchema.findByIdAndUpdate(
        id,
        { $set: recipe },
        { new: true },
      );
    } catch (err) {
      throw err;
    }
  },

  async deleteRecipe(id) {
    // 1. Get recipe to clean up its own library-level CustomProducts (ingredients)
    const recipe = await recipeSchema.findById(id).lean();
    if (recipe && recipe.customProducts && recipe.customProducts.length > 0) {
      await customProductSchema.deleteMany({
        _id: { $in: recipe.customProducts },
      });
    }

    // 2. Find customRecipes referencing this recipe
    const historicalCustomRecipes = await customRecipeSchema
      .find({ recipe: id }, "_id")
      .lean();
    const customRecipeIds = historicalCustomRecipes.map((ins) => ins._id);

    if (customRecipeIds.length > 0) {
      await mealSchema.updateMany(
        { customRecipes: { $in: customRecipeIds } },
        { $pull: { customRecipes: { $in: customRecipeIds } } },
      );
      await customRecipeSchema.deleteMany({
        _id: { $in: customRecipeIds },
      });
    }

    // 3. Clean up user archived recipes
    await userSchema.updateMany(
      { archivedRecipes: id },
      { $pull: { archivedRecipes: id } },
    );

    // 4. Finally delete the blueprint Recipe
    return recipeSchema.findByIdAndDelete(id);
  },

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

    let archivedRecipeIds = [];
    if (favoritesOnly) {
      const userDoc = await userSchema
        .findById(userObjectId)
        .select("archivedRecipes")
        .lean();
      archivedRecipeIds = userDoc?.archivedRecipes || [];
      if (!archivedRecipeIds.length) return [];
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

    if (favoritesOnly) {
      scope._id = { $in: archivedRecipeIds };
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
      context: { ownerId: userObjectId, favoriteIds: new Set(archivedRecipeIds.map(String)) },
      config,
    });
  },

  async composeRecipe(payload, userId, isAdmin = false) {
    try {
      const { recipe, recipeId, customRecipe, context, mode } = payload || {};

      let recipeDoc = null;
      let isEditMode = mode === "edit";

      if (recipeId) {
        recipeDoc = await this.getRecipeById(recipeId);

        if (!recipeDoc) {
          throw new Error("Recipe not found");
        }

        if (
          isEditMode &&
          recipe &&
          recipe.name &&
          (isAdmin || recipeDoc.userId?.toString() === userId)
        ) {
          const updateData = {
            name: recipe.name,
            description: recipe.description,
            customProducts: recipe.customProducts || [],
          };
          recipeDoc = await this.updateRecipe(recipeId, updateData);
        } else if (isEditMode && recipe) {
          throw new Error("Cannot edit recipes you don't own");
        }
      } else if (recipe) {
        const isDefault = isAdmin && recipe.verified === true;
        recipeDoc = await this.createRecipe({
          name: recipe.name,
          description: recipe.description,
          customProducts: recipe.customProducts || [],
          userId: isDefault ? undefined : userId,
          verified: isDefault ? true : false,
        });
      }

      if (!recipeDoc) {
        throw new Error("Recipe not found or not provided");
      }

      const hasMealContext = !!context?.mealId;
      // `context.dietInUseId` ya no se mira (el dueño del día es el usuario
      // autenticado); las apps viejas lo siguen mandando y no estorba.
      const hasNewDietDayContext =
        context?.indexMeal !== undefined && !!context?.currentDate;

      if (!hasMealContext && !hasNewDietDayContext) {
        return { recipe: recipeDoc };
      }

      let customRecipeDoc = null;
      const nextCustomRecipe = {
        recipe: recipeDoc._id,
        quantity: recipeMergeService.normalizePositiveNumber(
          customRecipe?.quantity,
        ),
        quantityCooked: recipeMergeService.normalizePositiveNumber(
          customRecipe?.quantityCooked,
        ),
        addedCustomProducts: customRecipe?.addedCustomProducts || [],
        modifiedBaseCustomProducts:
          customRecipe?.modifiedBaseCustomProducts || [],
        removedBaseCustomProductIds:
          customRecipe?.removedBaseCustomProductIds || [],
      };

      recipeMergeService.validateCustomRecipe(nextCustomRecipe);

      if (hasMealContext) {
        let updatedMeal = null;

        if (isEditMode && context?.customRecipeId) {
          customRecipeDoc = await customRecipeDao.update(
            context.customRecipeId,
            nextCustomRecipe,
          );
        } else {
          customRecipeDoc = await customRecipeDao.createCustomRecipe(
            nextCustomRecipe,
          );
        }

        if (isEditMode) {
          updatedMeal = await mealModel.findById(context.mealId);
        } else {
          updatedMeal = await mealModel.addMealCustomRecipe(
            context.mealId,
            customRecipeDoc._id.toString(),
          );
        }

        return {
          recipe: recipeDoc,
          customRecipe: customRecipeDoc,
          meal: updatedMeal,
        };
      }

      // Crear la receta y pautársela en una fecha que todavía no tiene día,
      // en una sola llamada. Dos arreglos aquí (2026-10):
      //   · el dueño del día es el usuario autenticado. Antes se pasaba
      //     `context.dietInUseId` (el id del wrapper Diet, que ya no existe)
      //     en el hueco del userId: el día nacía con un dueño que no era
      //     nadie, invisible para el cliente — y la siguiente lectura de esa
      //     fecha creaba OTRO día, el solapamiento que se veía en BD.
      //   · el día se asegura (resolveOwnedDietDay), no se crea a ciegas.
      const dietDay = await resolveOwnedDietDay(userId, context.currentDate);
      const updatedDietDay = await dietDayDao.addCustomRecipeToMeal(
        dietDay,
        context.indexMeal,
        nextCustomRecipe,
      );

      return {
        recipe: recipeDoc,
        dietDay: updatedDietDay,
      };
    } catch (err) {
      throw err;
    }
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

  async getArchivedRecipes(userId, page, limit, search) {
    return this.searchRecipes(page, limit, search, userId, {
      favoritesOnly: true,
    });
  },

  async toggleArchivedRecipe(userId, recipeId) {
    const user = await userSchema.findById(userId).select("archivedRecipes");
    const isArchived =
      user.archivedRecipes && user.archivedRecipes.includes(recipeId);

    const query = isArchived
      ? { $pull: { archivedRecipes: recipeId } }
      : { $push: { archivedRecipes: recipeId } };

    const updatedUser = await userSchema.findByIdAndUpdate(userId, query, {
      new: true,
    });
    return { user: updatedUser, isArchived: !isArchived };
  },

  async addRecipeCustomProduct(idRecipe, idCustomProduct) {
    const addRecipeCustomProduct = {
      $push: { customProducts: idCustomProduct },
    };
    return new Promise((resolve, reject) =>
      recipeSchema.findByIdAndUpdate(
        idRecipe,
        addRecipeCustomProduct,
        { new: true },
        (err, doc) => {
          if (err) return reject(err);
          return resolve(doc);
        },
      ),
    );
  },

  async removeRecipeCustomProduct(idRecipe, idCustomProduct) {
    return recipeSchema.findByIdAndUpdate(
      idRecipe,
      { $pull: { customProducts: idCustomProduct } },
      { new: true },
    );
  },
};
