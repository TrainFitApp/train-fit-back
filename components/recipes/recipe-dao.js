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

module.exports = {
  normalizeCustomProductId(value) {
    const normalizedValue = value?._id || value;
    return normalizedValue?.toString?.() || null;
  },

  buildCustomProductPayload(cpData) {
    return recipeMergeService.sanitizeCustomProductData(cpData, {
      includeProduct: true,
      includeId: true,
    });
  },

  async syncRecipeCustomProducts(nextCustomProducts, currentCustomProductIds = []) {
    const normalizedNextProducts = (nextCustomProducts || []).map((cpData) =>
      this.buildCustomProductPayload(cpData),
    );

    const currentIds = (currentCustomProductIds || [])
      .map((id) => this.normalizeCustomProductId(id))
      .filter(Boolean);
    const nextIds = [];

    for (const cpData of normalizedNextProducts) {
      const existingId = this.normalizeCustomProductId(cpData._id);
      delete cpData._id;

      if (existingId && currentIds.includes(existingId)) {
        await customProductSchema.findByIdAndUpdate(existingId, { $set: cpData });
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
      const nextModified = (customRecipe.modifiedBaseCustomProducts || []).filter((item) => {
        const baseId = item?.baseCustomProductId?._id || item?.baseCustomProductId;
        return !!baseId && validIds.has(baseId.toString());
      });
      const nextRemoved = (customRecipe.removedBaseCustomProductIds || []).filter((item) => {
        const baseId = item?._id || item;
        return !!baseId && validIds.has(baseId.toString());
      });

      if (
        nextModified.length !== (customRecipe.modifiedBaseCustomProducts || []).length ||
        nextRemoved.length !== (customRecipe.removedBaseCustomProductIds || []).length
      ) {
        customRecipe.modifiedBaseCustomProducts = nextModified;
        customRecipe.removedBaseCustomProductIds = nextRemoved;
        await customRecipe.save();
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

  async searchRecipes(page, limit, search, userId) {
    // All recipes view: current user's recipes + global recipes.
    const visibilityFilter = userId
      ? { $or: [{ userId }, { userId: { $exists: false } }] }
      : { userId: { $exists: false } };

    const query = {
      ...visibilityFilter,
      name: { $regex: search, $options: "i" },
    };

    return recipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
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

      if (hasMealContext) {
        let updatedMeal = null;

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
        customRecipeDoc.toObject(),
        context.indexMeal,
        context.dietInUseId,
        standardDietDay,
      );

      return {
        recipe: recipeDoc,
        customRecipe: customRecipeDoc,
        dietDay,
      };
    } catch (err) {
      throw err;
    }
  },

  async getUserRecipes(userId, page, limit) {
    return recipeSchema
      .find({ userId: userId })
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async getVerifiedRecipes(page, limit, search) {
    const query = search
      ? { verified: true, name: { $regex: search, $options: "i" } }
      : { verified: true };

    return recipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async getArchivedRecipes(userId, page, limit, search) {
    const user = await userSchema.findById(userId).select("archivedRecipes");
    if (!user || !user.archivedRecipes || user.archivedRecipes.length === 0) {
      return [];
    }

    const query = search
      ? {
          _id: { $in: user.archivedRecipes },
          name: { $regex: search, $options: "i" },
        }
      : { _id: { $in: user.archivedRecipes } };

    return recipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
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
