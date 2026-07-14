// const dayStepSchema = require("./schema");
// const userSchema = require("../users/schema");
const recipeSchema = require("./recipe-schema");
const userSchema = require("../users/schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const mealSchema = require("../meals/meal-schema");

const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const mealModel = require("../meals/meal-service");
const dietDayDao = require("../dietDays/diet-days-dao");
const dietDayUtil = require("../dietDays/diet-days-util");
const recipeMergeService = require("./recipe-merge.service");

const customProductSchema = require("../customProducts/custom-product-schema");
const mongoose = require("mongoose");
const {
  buildSearchFields,
  normalizeSearchText,
  splitSearchTokens,
  hasEditDistanceOneOrLess,
} = require("../util/search-index");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function toComparableId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.toString) return value.toString();
  return String(value);
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
      const searchFields = buildSearchFields(recipe);
      recipe.nameNormalized = searchFields.nameNormalized;
      recipe.namePrefixes = searchFields.namePrefixes;

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

      if (Object.prototype.hasOwnProperty.call(recipe, "name")) {
        const searchFields = buildSearchFields(recipe);
        recipe.nameNormalized = searchFields.nameNormalized;
        recipe.namePrefixes = searchFields.namePrefixes;
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

  async searchRecipes(page, limit, search, userId, filters = {}) {
    const ownOnly = !!filters.ownOnly;
    const favoritesOnly = !!filters.favoritesOnly;
    const verifiedOnly = !!filters.verifiedOnly;
    const userObjectId = toObjectId(userId);
    const pageValue = Math.max(0, parseInt((page || 0).toString(), 10));
    const limitValue = Math.max(1, parseInt((limit || 10).toString(), 10));
    const skipValue = pageValue * limitValue;
    const trimmedSearch = String(search || "").trim();
    const normalizedSearchQuery = normalizeSearchText(trimmedSearch);
    const searchTerms = splitSearchTokens(trimmedSearch);
    const hasSearch = normalizedSearchQuery.length > 0;
    const typoEnabled = normalizedSearchQuery.length > 2;
    const queryUpperBound = `${normalizedSearchQuery}\uffff`;
    const candidateLimitPerStage = 200;

    if ((ownOnly || favoritesOnly) && !userObjectId) {
      return [];
    }

    let archivedRecipeIds = [];
    if (favoritesOnly) {
      const userDoc = await userSchema.findById(userObjectId).select("archivedRecipes");
      archivedRecipeIds = userDoc?.archivedRecipes || [];
      if (!archivedRecipeIds.length) {
        return [];
      }
    }

    const visibilityClauses = [];
    if (ownOnly) {
      const ownClause = { userId: userObjectId };
      if (verifiedOnly) {
        ownClause.verified = true;
      }
      visibilityClauses.push(ownClause);
    } else {
      if (verifiedOnly) {
        visibilityClauses.push({ verified: true });
      } else {
        visibilityClauses.push({ verified: true });
        if (userObjectId) {
          visibilityClauses.push({ userId: userObjectId });
        }
      }
    }

    const baseQuery =
      visibilityClauses.length === 1
        ? { ...visibilityClauses[0] }
        : { $or: visibilityClauses };

    if (favoritesOnly) {
      baseQuery._id = { $in: archivedRecipeIds };
    }

    if (!hasSearch) {
      return recipeSchema
        .find(baseQuery)
        .sort({ name: 1, _id: 1 })
        .skip(skipValue)
        .limit(limitValue)
        .exec();
    }

    const candidatesById = new Map();
    const upsertCandidate = (doc, score, stagePriority) => {
      if (!doc?._id) return;
      const key = toComparableId(doc._id);
      const current = candidatesById.get(key);
      if (
        !current ||
        score > current.score ||
        (score === current.score && stagePriority > current.stagePriority)
      ) {
        candidatesById.set(key, { doc, score, stagePriority });
      }
    };

    const [exactDocs, startsWithDocs, prefixDocs, textDocs, missingDerivedDocs] =
      await Promise.all([
        recipeSchema
          .find({ ...baseQuery, nameNormalized: normalizedSearchQuery })
          .limit(candidateLimitPerStage)
          .lean()
          .exec(),
        recipeSchema
          .find({
            ...baseQuery,
            nameNormalized: {
              $gte: normalizedSearchQuery,
              $lte: queryUpperBound,
            },
          })
          .sort({ nameNormalized: 1, _id: 1 })
          .limit(candidateLimitPerStage)
          .lean()
          .exec(),
        recipeSchema
          .find({ ...baseQuery, namePrefixes: normalizedSearchQuery })
          .limit(candidateLimitPerStage)
          .lean()
          .exec(),
        recipeSchema
          .find(
            { ...baseQuery, $text: { $search: trimmedSearch } },
            { score: { $meta: "textScore" } },
          )
          .sort({ score: { $meta: "textScore" } })
          .limit(candidateLimitPerStage)
          .lean()
          .exec(),
        recipeSchema
          .find({
            $and: [
              baseQuery,
              {
                $or: [
                  { nameNormalized: { $exists: false } },
                  { namePrefixes: { $exists: false } },
                ],
              },
            ],
          })
          .limit(300)
          .lean()
          .exec(),
      ]);

    for (const doc of exactDocs) upsertCandidate(doc, 100000, 3);
    for (const doc of startsWithDocs) upsertCandidate(doc, 85000, 2);
    for (const doc of prefixDocs) upsertCandidate(doc, 70000, 1);
    for (const doc of textDocs) {
      upsertCandidate(doc, 40000 + Number(doc.score || 0) * 1200, 0);
    }

    for (const doc of missingDerivedDocs) {
      const searchFields = buildSearchFields(doc);
      const enrichedDoc = {
        ...doc,
        nameNormalized: searchFields.nameNormalized,
        namePrefixes: searchFields.namePrefixes,
      };

      if (enrichedDoc.nameNormalized === normalizedSearchQuery) {
        upsertCandidate(enrichedDoc, 95000, 2);
        continue;
      }

      if (Array.isArray(enrichedDoc.namePrefixes)) {
        if (enrichedDoc.namePrefixes.includes(normalizedSearchQuery)) {
          upsertCandidate(enrichedDoc, 68000, 1);
          continue;
        }
      }

      if (enrichedDoc.nameNormalized?.includes(normalizedSearchQuery)) {
        upsertCandidate(enrichedDoc, 30000, 0);
      }
    }

    const scoredCandidates = Array.from(candidatesById.values()).map(
      (candidate) => {
        const nameNormalized = normalizeSearchText(
          candidate.doc.nameNormalized || candidate.doc.name,
        );
        const nameTokens = splitSearchTokens(nameNormalized);
        let score = candidate.score;
        let matchPriority = 0;

        if (nameNormalized === normalizedSearchQuery) matchPriority = 900;
        else if (nameNormalized.startsWith(`${normalizedSearchQuery} `)) {
          matchPriority = 850;
        } else if (nameNormalized.startsWith(normalizedSearchQuery)) {
          matchPriority = 820;
        } else if (nameTokens.includes(normalizedSearchQuery)) {
          matchPriority = 780;
        } else if (
          nameTokens.some((token) => token.startsWith(normalizedSearchQuery))
        ) {
          matchPriority = 740;
        } else if (nameNormalized.includes(normalizedSearchQuery)) {
          matchPriority = 700;
        }

        for (const term of searchTerms) {
          if (nameTokens.includes(term)) score += 1800;
          else if (nameTokens.some((token) => token.startsWith(term))) {
            score += 650;
          }

          if (
            typoEnabled &&
            nameTokens.some((token) => hasEditDistanceOneOrLess(token, term))
          ) {
            score += 350;
          }
        }

        return {
          ...candidate,
          score,
          matchPriority,
        };
      },
    );

    scoredCandidates.sort((left, right) => {
      if (left.matchPriority !== right.matchPriority) {
        return right.matchPriority - left.matchPriority;
      }
      if (left.score !== right.score) return right.score - left.score;
      if (left.stagePriority !== right.stagePriority) {
        return right.stagePriority - left.stagePriority;
      }
      const nameOrder = (left.doc.name || "").localeCompare(right.doc.name || "");
      if (nameOrder !== 0) return nameOrder;
      return toComparableId(left.doc._id).localeCompare(toComparableId(right.doc._id));
    });

    // Las etapas anteriores usan .lean() (necesario para poder fusionar/puntuar
    // candidatas de 5 queries distintas), lo que se salta el autopopulate de
    // customProducts. Solo se puebla la página final que realmente se devuelve,
    // no las ~1000 candidatas descartadas por las demás páginas.
    const paginatedDocs = scoredCandidates
      .slice(skipValue, skipValue + limitValue)
      .map((candidate) => candidate.doc);

    return recipeSchema.populate(paginatedDocs, { path: "customProducts" });
  },

  async composeRecipe(payload, userId) {
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
          recipeDoc.userId?.toString() === userId
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
        recipeDoc = await this.createRecipe({
          name: recipe.name,
          description: recipe.description,
          customProducts: recipe.customProducts || [],
          userId,
          verified: false,
        });
      }

      if (!recipeDoc) {
        throw new Error("Recipe not found or not provided");
      }

      const hasMealContext = !!context?.mealId;
      const hasNewDietDayContext =
        !!context?.dietInUseId &&
        context?.indexMeal !== undefined &&
        context?.currentDate;

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

      const standardDietDay = dietDayUtil.getStandardDietDay(context.currentDate);
      const dietDay = await dietDayDao.createCustomRecipeOnNewDietDay(
        nextCustomRecipe,
        context.indexMeal,
        context.dietInUseId,
        standardDietDay,
      );

      return {
        recipe: recipeDoc,
        dietDay,
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
