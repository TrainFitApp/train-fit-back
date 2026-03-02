// const dayStepSchema = require("./schema");
// const userSchema = require("../users/schema");
const recipeSchema = require("./recipe-schema");
const userSchema = require("../users/schema");
const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");
const customRecipeInstanceSchema = require("../customRecipes/custom-recipe-schema");
const mealSchema = require("../meals/meal-schema");

const dataRecipeDao = require("../dataRecipes/data-recipe-dao");
const customRecipeInstanceDao = require("../customRecipes/custom-recipe-instance-dao");
const mealModel = require("../meals/meal-service");
const dietDayDao = require("../dietDays/diet-days-dao");
const dietDayUtil = require("../dietDays/diet-days-util");

const customProductSchema = require("../customProducts/custom-product-schema");

module.exports = {
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
      if (recipe.customProducts && recipe.customProducts.length > 0) {
        const customProductIds = [];

        for (const cpData of recipe.customProducts) {
          // If product is already a string (ID), use it directly (reference to existing product)
          const productId = cpData.product?._id || cpData.product;

          // If it's just { quantity, product: "id" }, use as reference only
          if (
            typeof productId === "string" &&
            !cpData.energyKcal100g &&
            !cpData.protein100g &&
            !cpData.carbohydrates100g &&
            !cpData.fat100g
          ) {
            // This is a reference to an existing product - create CustomProduct with just reference
            const refCP = {
              quantity: cpData.quantity,
              product: productId || undefined,
            };
            Object.keys(refCP).forEach(
              (key) => refCP[key] === undefined && delete refCP[key],
            );
            const createdCP = await customProductSchema.create(refCP);
            customProductIds.push(createdCP._id);
          } else {
            // This is a full CustomProduct (new or with macro overrides)
            const newCP = {
              quantity: cpData.quantity,
              product: productId,
              energyKcal100g: cpData.energyKcal100g,
              protein100g: cpData.protein100g,
              carbohydrates100g: cpData.carbohydrates100g,
              fat100g: cpData.fat100g,
            };

            Object.keys(newCP).forEach(
              (key) => newCP[key] === undefined && delete newCP[key],
            );

            const createdCP = await customProductSchema.create(newCP);
            customProductIds.push(createdCP._id);
          }
        }

        recipe.customProducts = customProductIds;
      }

      return await recipeSchema.create(recipe);
    } catch (err) {
      throw err;
    }
  },

  async updateRecipe(id, recipe) {
    try {
      if (recipe.customProducts && recipe.customProducts.length > 0) {
        const customProductIds = [];

        for (const cpData of recipe.customProducts) {
          // Si ya es un ID (string), lo mantenemos tal cual
          if (typeof cpData === "string") {
            customProductIds.push(cpData);
            continue;
          }

          // Extract product ID
          const productId = cpData.product?._id || cpData.product;

          // If it's just { quantity, product: "id" }, use as reference only
          if (
            typeof productId === "string" &&
            !cpData.energyKcal100g &&
            !cpData.protein100g &&
            !cpData.carbohydrates100g &&
            !cpData.fat100g
          ) {
            // This is a reference to an existing product - create CustomProduct with just reference
            const refCP = {
              quantity: cpData.quantity,
              product: productId || undefined,
            };
            Object.keys(refCP).forEach(
              (key) => refCP[key] === undefined && delete refCP[key],
            );
            const createdCP = await customProductSchema.create(refCP);
            customProductIds.push(createdCP._id);
          } else {
            // This is a full CustomProduct (new or with macro overrides)
            const newCP = {
              quantity: cpData.quantity,
              product: productId,
              energyKcal100g: cpData.energyKcal100g,
              protein100g: cpData.protein100g,
              carbohydrates100g: cpData.carbohydrates100g,
              fat100g: cpData.fat100g,
            };

            Object.keys(newCP).forEach(
              (key) => newCP[key] === undefined && delete newCP[key],
            );

            const createdCP = await customProductSchema.create(newCP);
            customProductIds.push(createdCP._id);
          }
        }

        recipe.customProducts = customProductIds;
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

    // 2. Find ALL historical traces (DataRecipes and direct Instances)
    const dataRecipes = await dataRecipeSchema
      .find({ recipe: id }, "_id")
      .lean();
    const dataRecipeIds = dataRecipes.map((dr) => dr._id);

    // Find instances via DataRecipe (legacy) OR direct recipe reference (optimized)
    const historicalInstances = await customRecipeInstanceSchema
      .find({
        $or: [{ dataRecipe: { $in: dataRecipeIds } }, { recipe: id }],
      })
      .lean();

    const instanceIds = historicalInstances.map((ins) => ins._id);

    if (instanceIds.length > 0) {
      // 2.a Clean up overrides (CustomProducts created specifically for these instances)
      const overrideIds = historicalInstances.flatMap(
        (ins) => ins.customProductsOverrides || [],
      );
      if (overrideIds.length > 0) {
        await customProductSchema.deleteMany({ _id: { $in: overrideIds } });
      }

      // 2.b Remove references from all meals in history
      await mealSchema.updateMany(
        { customRecipeInstances: { $in: instanceIds } },
        { $pull: { customRecipeInstances: { $in: instanceIds } } },
      );

      // 2.c Delete the instances themselves
      await customRecipeInstanceSchema.deleteMany({
        _id: { $in: instanceIds },
      });
    }

    // 3. Delete historical snapshots (DataRecipes)
    if (dataRecipeIds.length > 0) {
      await dataRecipeSchema.deleteMany({ _id: { $in: dataRecipeIds } });
    }

    // 4. Clean up user favorites AND archives
    await userSchema.updateMany(
      { $or: [{ favoriteRecipes: id }, { archivedRecipes: id }] },
      { $pull: { favoriteRecipes: id, archivedRecipes: id } },
    );

    // 5. Finally delete the blueprint Recipe
    return recipeSchema.findByIdAndDelete(id);
  },

  async searchRecipes(page, limit, search, userId) {
    // Search ALL recipes (verified, user's own, and others)
    const query = {
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
      const { recipe, recipeId, dataRecipe, instance, context, mode } =
        payload || {};

      let recipeDoc = null;
      let isEditMode = mode === "edit";

      if (recipeId) {
        recipeDoc = await this.getRecipeById(recipeId);

        // If edit mode and user is owner, update recipe definition
        if (isEditMode && recipe && recipe.name) {
          const updateData = {
            name: recipe.name,
            description: recipe.description,
            customProducts: recipe.customProducts || [],
          };
          recipeDoc = await this.updateRecipe(recipeId, updateData);
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

      // For edit mode, update existing dataRecipe or create new one
      let dataRecipeDoc = null;
      if (isEditMode && context?.dataRecipeId) {
        dataRecipeDoc = await dataRecipeDao.update(context.dataRecipeId, {
          quantity: dataRecipe?.quantity,
          quantityCooked: dataRecipe?.quantityCooked,
        });
      } else {
        dataRecipeDoc = await dataRecipeDao.create({
          recipeId: recipeDoc._id,
          quantity: dataRecipe?.quantity,
          quantityCooked: dataRecipe?.quantityCooked,
        });
      }

      const instanceQuantity =
        instance?.quantity ??
        dataRecipe?.quantity ??
        dataRecipe?.quantityCooked;

      let instanceData = {
        quantity: instanceQuantity,
        customProductsOverrides: instance?.customProductsOverrides || [],
        additionalCustomProducts: instance?.additionalCustomProducts || [],
      };

      // For edit mode, use existing dataRecipe; for create, set new one
      if (!isEditMode) {
        instanceData.dataRecipeId = dataRecipeDoc._id;
      }

      let customRecipeInstance = null;

      if (isEditMode && context?.customRecipeInstanceId) {
        // Update existing instance
        customRecipeInstance = await customRecipeInstanceDao.update(
          context.customRecipeInstanceId,
          instanceData,
        );
      } else if (!isEditMode) {
        // Create new instance
        customRecipeInstance =
          await customRecipeInstanceDao.create(instanceData);
      }

      if (hasMealContext) {
        let updatedMeal = null;

        if (isEditMode) {
          // For edit mode, instance is already in meal, just fetch it
          updatedMeal = await mealModel.findById(context.mealId);
        } else {
          // For create mode, add instance to meal
          updatedMeal = await mealModel.addMealCustomRecipeInstance(
            context.mealId,
            customRecipeInstance._id.toString(),
          );
        }

        return {
          recipe: recipeDoc,
          dataRecipe: dataRecipeDoc,
          customRecipeInstance,
          meal: updatedMeal,
        };
      }

      const standardDietDay = dietDayUtil.getStandardDietDay(
        context.currentDate,
      );
      const dietDay = await dietDayDao.createCustomRecipeInstanceOnNewDietDay(
        { ...instanceData, dataRecipeId: dataRecipeDoc._id },
        context.indexMeal,
        context.dietInUseId,
        standardDietDay,
      );

      return {
        recipe: recipeDoc,
        dataRecipe: dataRecipeDoc,
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

  async getFavoriteRecipes(userId, page, limit, search) {
    const user = await userSchema.findById(userId).select("favoriteRecipes");
    if (!user || !user.favoriteRecipes || user.favoriteRecipes.length === 0) {
      return [];
    }

    const query = search
      ? {
          _id: { $in: user.favoriteRecipes },
          name: { $regex: search, $options: "i" },
        }
      : { _id: { $in: user.favoriteRecipes } };

    return recipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async toggleFavoriteRecipe(userId, recipeId) {
    const user = await userSchema.findById(userId).select("favoriteRecipes");
    const isFavorite =
      user.favoriteRecipes && user.favoriteRecipes.includes(recipeId);

    const query = isFavorite
      ? { $pull: { favoriteRecipes: recipeId } }
      : { $push: { favoriteRecipes: recipeId } };

    const updatedUser = await userSchema.findByIdAndUpdate(userId, query, {
      new: true,
    });
    return { user: updatedUser, isFavorite: !isFavorite };
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
