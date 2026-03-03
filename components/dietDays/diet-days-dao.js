const dietDaySchema = require("./diet-days-schema");
const dietSchema = require("../diets/diet-schema");
const mealSchema = require("../meals/meal-schema");
const mealModel = require("../meals/meal-service");
const productSchema = require("../products/product-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const { default: mongoose } = require("mongoose");
const dietModel = require("../diets/diet-model");
const userSchema = require("../users/schema");
const dietDaysUtil = require("./diet-days-util");

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
      // Unified support: Si viene product inline (unificado)
      if (idUser && customProduct?.product && !customProduct.product._id) {
        const productDoc = await productSchema.create({
          ...customProduct.product,
          userId: idUser,
        });
        customProduct.product = productDoc._id;
      }

      // Creación customProduct
      const customProductDoc = await customProductSchema.create(customProduct);
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

  async createDataRecipeOnNewDietDay(
    dataRecipe,
    indexMeal,
    dietInUseId,
    dietDay,
  ) {
    try {
      // 1. Crear el DataRecipe
      const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");

      // Ensure recipe is an ID (robustness)
      const recipeId =
        dataRecipe.recipeId || dataRecipe.recipe?._id || dataRecipe.recipe;
      const payload = {
        recipe: recipeId,
        quantity: dataRecipe.quantity,
        quantityCooked: dataRecipe.quantityCooked,
      };

      const dataRecipeDoc = await dataRecipeSchema.create(payload);

      // 2. Crear DietDay
      let dietDayDoc = await this.createDietDay(dietDay);
      const dietDayId = dietDayDoc._id.toString();

      // 3. Añadir DietDay a la Dieta
      const dietDoc = await dietModel.addDietDietDay(dietInUseId, dietDayId);

      // 4. Recuperar el DietDay actualizado dentro de la dieta (para asegurar consistencia)
      const diet = dietDoc.toObject();
      const indexDietDay = diet.dietsDay.findIndex(
        (dietDayTemp) => dietDayTemp._id.toString() === dietDayId,
      );
      dietDayDoc = diet.dietsDay[indexDietDay];

      // 5. Añadir DataRecipe a la Meal correspondiente
      let meal = dietDayDoc.meals[indexMeal];
      // Usamos el mealModel para añadir el dataRecipe
      // mealModel.addDataRecipeToMeal no existe explícitamente en el snippet anterior,
      // pero asumimos que podemos hacerlo vía update directo si no.
      // Mejor usamos update directo sobre mealSchema para añadir el dataRecipe

      const mealUpdate = { $push: { dataRecipes: dataRecipeDoc._id } };
      await mealSchema.findByIdAndUpdate(meal._id, mealUpdate);

      // Actualizamos el objeto meal local para devolverlo
      if (!meal.dataRecipes) meal.dataRecipes = [];
      // dataRecipeDoc es un documento mongoose, toObject para devolver limpio o usar directamente
      meal.dataRecipes.push(dataRecipeDoc);

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
      // Creación customRecipe
      const customRecipeDoc = await customRecipeSchema.create(customRecipe);
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

  // Create dietDay with meals and add CustomRecipeInstance
  async createCustomRecipeInstanceOnNewDietDay(
    customRecipeInstance,
    indexMeal,
    dietInUseId,
    dietDay,
  ) {
    try {
      const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

      // Map dataRecipeId to dataRecipe for schema compatibility
      if (customRecipeInstance.dataRecipeId) {
        customRecipeInstance.dataRecipe = customRecipeInstance.dataRecipeId;
        delete customRecipeInstance.dataRecipeId;
      }

      // 1. Create CustomRecipeInstance
      const customRecipeInstanceDoc =
        await customRecipeSchema.create(customRecipeInstance);

      // 2. Create DietDay with meals
      let dietDayDoc = await this.createDietDay(dietDay);
      const dietDayId = dietDayDoc._id.toString();

      // 3. Add DietDay to Diet
      const dietDoc = await dietModel.addDietDietDay(dietInUseId, dietDayId);

      // 4. Get the created dietDay from the updated diet
      const diet = dietDoc.toObject();
      const indexDietDay = diet.dietsDay.findIndex(
        (dietDayTemp) => dietDayTemp._id.toString() === dietDayId,
      );
      dietDayDoc = diet.dietsDay[indexDietDay];

      // 5. Get the current meal
      let meal = dietDayDoc.meals[indexMeal];

      // 6. Add CustomRecipeInstance to meal
      meal = await mealModel.addMealCustomRecipeInstance(
        meal._id.toString(),
        customRecipeInstanceDoc._id.toString(),
      );

      // 7. Update meal in dietDay
      dietDayDoc.meals[indexMeal] = meal;

      return dietDayDoc;
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
    const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");
    const normalizeId = (value) => value?._id || value;
    const toPlainObject = (value) =>
      value?.toObject ? value.toObject() : { ...value };
    const getDataRecipePayload = async (instanceObj) => {
      let dataRecipeObj = instanceObj.dataRecipe;

      if (dataRecipeObj && !dataRecipeObj.recipe) {
        dataRecipeObj = await dataRecipeSchema.findById(dataRecipeObj).lean();
      }

      if (!dataRecipeObj) {
        return null;
      }

      const recipeId = normalizeId(dataRecipeObj.recipe);
      if (!recipeId) {
        return null;
      }

      return {
        recipe: recipeId,
        quantity: dataRecipeObj.quantity,
        quantityCooked: dataRecipeObj.quantityCooked,
      };
    };

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

      const createdCustomRecipeInstances = [];
      const sourceInstances =
        mealObj.customRecipeInstances || mealObj.customRecipes || [];

      for (const instanceRef of sourceInstances) {
        const instanceObj = toPlainObject(instanceRef);

        const dataRecipePayload = await getDataRecipePayload(instanceObj);
        if (!dataRecipePayload) {
          continue;
        }

        const newDataRecipe = await dataRecipeSchema.create(dataRecipePayload);

        const customProductsOverrides = (
          instanceObj.customProductsOverrides || []
        )
          .map((override) => ({
            customProductId: normalizeId(override.customProductId),
            quantity:
              override.quantity === undefined ? null : override.quantity,
            removed: !!override.removed,
          }))
          .filter((override) => !!override.customProductId);

        const additionalCustomProducts = (
          instanceObj.additionalCustomProducts || []
        )
          .map((additional) => ({
            quantity: additional.quantity,
            product: normalizeId(additional.product),
          }))
          .filter((additional) => !!additional.product);

        const newCustomRecipeInstance = await customRecipeSchema.create({
          dataRecipe: newDataRecipe._id,
          quantity: instanceObj.quantity ?? 0,
          customProductsOverrides,
          additionalCustomProducts,
        });

        createdCustomRecipeInstances.push(newCustomRecipeInstance._id);
      }

      const createdMeal = await mealSchema.create({
        name: mealObj.name,
        notes: mealObj.notes,
        customProducts: createdCustomProducts.map((cp) => cp._id),
        customRecipeInstances: createdCustomRecipeInstances,
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
