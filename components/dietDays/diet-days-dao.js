const dietDaySchema = require("./diet-days-schema");
const dietSchema = require("../diets/diet-schema");
const mealSchema = require("../meals/meal-schema");
const mealModel = require("../meals/meal-service");
const productSchema = require("../products/product-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const { default: mongoose } = require("mongoose");
const dietModel = require("../diets/diet-model");
const userSchema = require("../users/schema");
const dietDaysUtil = require("./diet-days-util");

const isBlankString = (value) =>
  typeof value === "string" && value.trim() === "";

const cleanForCreate = (payload = {}) => {
  const cleaned = {};
  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (value === undefined) return;
    if (isBlankString(value)) return;
    cleaned[key] = value;
  });
  return cleaned;
};

module.exports = {
  async findAll(page, limit) {
    return new Promise((resolve, reject) =>
      dietDaySchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async findByIdDietAndDate(id, date) {
    return new Promise((resolve, reject) =>
      dietSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        if (!doc) return resolve(null);

        // Find the diet day by comparing dates using the utility function
        const foundDietDay = doc.dietsDay.find((dd) => {
          return dietDaysUtil.datesAreOnSameDay(dd.date, date);
        });

        return resolve(foundDietDay);
      }),
    );
  },

  async getDietDaysWeightsBetweenDatesByIdDiet(id, startDate, endDate) {
    const agg = [
      {
        $match: {
          _id: new mongoose.Types.ObjectId(id),
        },
      },
      {
        $lookup: {
          from: "dietdays",
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $gte: ["$date", startDate],
                    },
                    {
                      $lte: ["$date", endDate],
                    },
                  ],
                },
                weight: { $exists: true, $ne: null },
              },
            },
            {
              $sort: {
                date: 1,
              },
            },
            {
              $project: {
                _id: 0,
                weight: 1,
              },
            },
          ],
          localField: "dietsDay",
          foreignField: "_id",
          as: "dietDays",
        },
      },
    ];

    return await dietSchema.aggregate(agg);
  },

  async getDietDaysBetweenDatesByIdDiet(id, startDate, endDate) {
    const agg = [
      {
        $match: {
          _id: new mongoose.Types.ObjectId(id),
        },
      },
      {
        $lookup: {
          from: "dietdays",
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $gte: ["$date", startDate],
                    },
                    {
                      $lte: ["$date", endDate],
                    },
                  ],
                },
              },
            },
            {
              $sort: {
                date: 1,
              },
            },
            {
              $lookup: {
                from: "meals",
                localField: "meals",
                foreignField: "_id",
                as: "meals",
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                date: 1,
                weight: 1,
                notes: 1,
                meals: {
                  _id: 1,
                  name: 1,
                  notes: 1,
                },
              },
            },
          ],
          localField: "dietsDay",
          foreignField: "_id",
          as: "dietDays",
        },
      },
      {
        $project: {
          _id: 0,
          name: 0,
          __v: 0,
          dietsDay: 0,
        },
      },
    ];

    return await dietSchema.aggregate(agg);
  },

  async createDietDay(standardDietDay) {
    try {
      let meals = standardDietDay.meals;

      meals = await mealSchema.insertMany(meals);

      const mealIds = meals.map((mealTemp) => mealTemp._id);
      standardDietDay.meals = mealIds;

      const dietDay = await dietDaySchema.create(standardDietDay);
      return dietDay;
    } catch (err) {
      throw err;
    }

    // // TODO AÑADIR LOS PRODUCTOS
    // return new Promise((resolve, reject) =>
    //   mealSchema.insertMany(meals, (err2, mealDocs) => {
    //     if (err2) return reject(err2);

    //     let ids = mealDocs.map((mealTemp) => mealTemp._id);

    //     dietDay.meals = mealDocs;

    //     dietDaySchema.create(
    //       dietDay,
    //       { $set: { meals: ids } },
    //       { new: true },
    //       (err3, doc3) => {
    //         if (err3) return reject(err3);

    //         return resolve(doc3);
    //       }
    //     );
    //   })
    // );
  },

  // Crea dietDay con meals y añade dayWeight
  async createDayWeightOnNewDietDay(dayWeight, dietInUseId, dietDay) {
    try {
      dietDay.weight = dayWeight;
      // Creación dietDay
      const dietDayDoc = await this.createDietDay(dietDay);
      const dietDayId = dietDayDoc._id.toString();
      // Asignación de dietDay a diet
      await dietModel.addDietDietDay(dietInUseId, dietDayId);
      return dietDayDoc;
    } catch (error) {
      throw error;
    }
  },

  // Crea dietDay con meals y añade custom product
  async createCustomProductOnNewDietDay(
    customProduct,
    indexMeal,
    dietInUseId,
    dietDay,
    idUser,
  ) {
    try {
      const cleanedCustomProduct = cleanForCreate(customProduct);

      // Unified support: Si viene product inline (unificado)
      if (
        idUser &&
        cleanedCustomProduct?.product &&
        !cleanedCustomProduct.product._id
      ) {
        const productDoc = await productSchema.create({
          ...cleanedCustomProduct.product,
          userId: idUser,
        });
        cleanedCustomProduct.product = productDoc._id;
      }

      // Creación customProduct
      const customProductDoc = await customProductSchema.create(
        cleanedCustomProduct,
      );
      // Creación dietDay
      let dietDayDoc = await this.createDietDay(dietDay);
      const dietDayId = dietDayDoc._id.toString();
      // Asignación de dietDay a diet
      const dietDoc = await dietModel.addDietDietDay(dietInUseId, dietDayId);
      // Obtención de dietDay dentro de la diet actualizada
      const diet = dietDoc.toObject();
      const indexDietDay = diet.dietsDay.findIndex(
        (dietDayTemp) => dietDayTemp._id.toString() === dietDayId,
      );
      dietDayDoc = diet.dietsDay[indexDietDay];
      // Obtención de la meal actual
      let meal = dietDayDoc.meals[indexMeal];
      // Asignación de customProduct a meal
      meal = await mealModel.addMealProduct(
        meal._id.toString(),
        customProductDoc._id.toString(),
      );
      // Asignación de meal a dietDay
      dietDayDoc.meals[indexMeal] = meal;
      dietDayDoc.meals[indexMeal] = meal;
      return dietDayDoc;
    } catch (error) {
      throw error;
    }
  },

  // Crea dietDay con meals y añade custom recipe
  async createCustomRecipeOnNewDietDay(
    customRecipe,
    indexMeal,
    dietInUseId,
    dietDay,
  ) {
    try {
      const customRecipeToCreate = customRecipe?.toObject
        ? customRecipe.toObject()
        : { ...customRecipe };
      delete customRecipeToCreate._id;

      // Creación customRecipe
      const customRecipeDoc =
        await customRecipeDao.createCustomRecipe(customRecipeToCreate);
      // Creación dietDay
      let dietDayDoc = await this.createDietDay(dietDay);
      const dietDayId = dietDayDoc._id.toString();
      // Asignación de dietDay a diet
      const dietDoc = await dietModel.addDietDietDay(dietInUseId, dietDayId);
      // Obtención de dietDay dentro de la diet actualizada
      const diet = dietDoc.toObject();
      const indexDietDay = diet.dietsDay.findIndex(
        (dietDayTemp) => dietDayTemp._id.toString() === dietDayId,
      );
      dietDayDoc = diet.dietsDay[indexDietDay];
      // Obtención de la meal actual
      let meal = dietDayDoc.meals[indexMeal];
      // Asignación de customRecipe a meal
      meal = await mealModel.addMealCustomRecipe(
        meal._id.toString(),
        customRecipeDoc._id.toString(),
      );
      // Asignación de meal a dietDay
      dietDayDoc.meals[indexMeal] = meal;
      return dietDayDoc;
    } catch (error) {
      throw error;
    }
  },

  async createOwnCustomRecipeOnNewDietDay(
    idUser,
    customRecipe,
    dietDay,
    indexMeal,
  ) {
    try {
      let recipeToCreate = { ...customRecipe };
      delete recipeToCreate.quantity;
      delete recipeToCreate.customProducts;

      let meals = dietDay.meals;
      meals = await mealSchema.insertMany(meals);
      const mealIds = meals.map((mealTemp) => mealTemp._id);
      dietDay.meals = mealIds;
      const dietDayDoc = await dietDaySchema.create(dietDay);

      let userDoc = await userSchema.findById(idUser);

      const queryUpdate = { $push: { dietsDay: dietDayDoc._id } };
      await dietSchema.findByIdAndUpdate(userDoc.dietInUse, queryUpdate);

      let customRecipeDoc = await customRecipeSchema.create(recipeToCreate);

      customRecipe.customProducts.map(
        (customProductTemp) => delete customProductTemp?._id,
      );

      const customProductsDoc = await customProductSchema.insertMany(
        customRecipe.customProducts,
      );
      const query2 = {
        $push: {
          customProducts: {
            $each: customProductsDoc.map((cp) => cp._id),
          },
        },
      };
      customRecipeDoc = await customRecipeSchema.findByIdAndUpdate(
        customRecipeDoc._id,
        query2,
        { new: true },
      );

      const queryMeal = { $push: { customRecipes: customRecipeDoc._id } };
      await mealSchema.findByIdAndUpdate(meals[indexMeal]._id, queryMeal);

      const newDietDay = await dietDaySchema.findById(dietDayDoc._id);

      return newDietDay;
    } catch (error) {
      throw error;
    }
  },

  async addDietDayMeal(idDietDay, idMeal) {
    const addMeal = {
      $push: { meals: idMeal },
    };

    return new Promise((resolve, reject) =>
      dietDaySchema.findByIdAndUpdate(idDietDay, addMeal, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async deleteDietDayMeal(idDietDay, idMeal) {
    const deleteMeal = {
      $pull: { meals: idMeal },
    };

    return new Promise((resolve, reject) =>
      dietDaySchema.findByIdAndUpdate(
        idDietDay,
        deleteMeal,
        { new: true },
        async (err, docs) => {
          if (err) return reject(err);

          try {
            // Delete the Meal document to trigger cascade cleanup
            await mealSchema.deleteOne({ _id: idMeal });
            return resolve(docs);
          } catch (deleteErr) {
            return reject(deleteErr);
          }
        },
      ),
    );
  },

  async updateDietDay(id, { name, weight, date, meals, notes }) {
    const dietDay = { name, weight, date, meals, notes };

    const update = { $set: { name, weight, date, meals } };

    if (!dietDay.notes || dietDay.notes?.trim() === "")
      update.$unset = { notes: "" };
    else update.$set.notes = notes;

    return new Promise((resolve, reject) =>
      dietDaySchema.findByIdAndUpdate(
        id,
        update,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async pasteDietDayByIdDiet(id, dietDayClipboard, dietDayToPaste) {
    const normalizeId = (value) => value?._id || value;
    const toPlainObject = (value) =>
      value?.toObject ? value.toObject() : { ...value };
    const cloneCustomProductPayload = (value) => {
      const payload = toPlainObject(value);
      delete payload._id;
      return payload;
    };
    const buildCustomRecipeClonePayload = (customRecipeObj) => ({
      recipe: normalizeId(customRecipeObj.recipe),
      quantity: customRecipeObj.quantity ?? null,
      quantityCooked: customRecipeObj.quantityCooked ?? null,
      addedCustomProducts: (
        customRecipeObj.addedCustomProducts ||
        customRecipeObj.additionalCustomProducts ||
        []
      ).map(cloneCustomProductPayload),
      modifiedBaseCustomProducts: (
        customRecipeObj.modifiedBaseCustomProducts ||
        customRecipeObj.customProductsOverrides ||
        []
      )
        .map((override) => {
          const payload = cloneCustomProductPayload(override);
          payload.baseCustomProductId = normalizeId(
            payload.baseCustomProductId || payload.customProductId,
          );
          delete payload.customProductId;
          delete payload.removed;
          return payload;
        })
        .filter((override) => override.baseCustomProductId),
      removedBaseCustomProductIds: (
        customRecipeObj.removedBaseCustomProductIds ||
        (customRecipeObj.customProductsOverrides || [])
          .filter((override) => override.removed)
          .map((override) => override.customProductId) ||
        []
      )
        .map((removedId) => normalizeId(removedId))
        .filter(Boolean),
    });

    const mealsToCreate = [];

    for (const mealRef of dietDayClipboard.meals || []) {
      const mealObj = toPlainObject(mealRef);

      const customProductsToCreate = (mealObj.customProducts || []).map(
        (customProductRef) => {
          const customProduct = toPlainObject(customProductRef);
          delete customProduct._id;
          return customProduct;
        },
      );

      const createdCustomProducts = customProductsToCreate.length
        ? await customProductSchema.insertMany(customProductsToCreate)
        : [];

      const createdCustomRecipes = [];
      const sourceCustomRecipes = mealObj.customRecipes || [];

      for (const customRecipeRef of sourceCustomRecipes) {
        const customRecipeObj = toPlainObject(customRecipeRef);
        const recipeId = normalizeId(
          customRecipeObj.recipe,
        );

        if (!recipeId) {
          continue;
        }

        const newCustomRecipe = await customRecipeDao.createCustomRecipe(
          buildCustomRecipeClonePayload(customRecipeObj),
        );

        createdCustomRecipes.push(newCustomRecipe._id);
      }

      const createdMeal = await mealSchema.create({
        name: mealObj.name,
        notes: mealObj.notes,
        customProducts: createdCustomProducts.map((cp) => cp._id),
        customRecipes: createdCustomRecipes,
      });

      mealsToCreate.push(createdMeal._id);
    }

    try {
      if (dietDayToPaste._id) {
        await dietDaySchema.deleteOne({ _id: dietDayToPaste._id });
      }

      const newDietDay = { ...dietDayClipboard };
      delete newDietDay._id;
      // Conditionally set weight based on dietDayToPaste.weight
      if (dietDayToPaste.weight) {
        newDietDay.weight = dietDayToPaste.weight;
      } else {
        delete newDietDay.weight;
      }
      newDietDay.meals = mealsToCreate;
      newDietDay.date = dietDayToPaste.date;

      const doc6 = await dietDaySchema.create(newDietDay);
      await dietSchema.findByIdAndUpdate(id, { $push: { dietsDay: doc6._id } });

      return doc6;
    } catch (err) {
      throw err;
    }
  },

  async deleteDietDay(idDiet, idDietDay) {
    try {
      const unlinkDietDietDay = { $pull: { dietsDay: idDietDay } };
      await dietSchema.findByIdAndUpdate(idDiet, unlinkDietDietDay);
      return await dietDaySchema.deleteOne({ _id: idDietDay });
    } catch (err) {
      throw err;
    }
  },
};
