const dietDaySchema = require("./diet-days-schema");
const mealSchema = require("../meals/meal-schema");
const mealModel = require("../meals/meal-service");
const productSchema = require("../products/product-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const { default: mongoose } = require("mongoose");
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

  // Refactor nutrición (2026-09) — antes: findById sobre el wrapper Diet, que
  // con autopopulate arrastraba TODOS los días del usuario (con sus comidas y
  // productos) para después filtrar uno en JavaScript. Ahora es un findOne
  // sobre el índice (userId, date).
  async findByUserAndDate(userId, date) {
    return dietDaySchema.findOne({ userId, date });
  },

  // Refactor nutrición (2026-09) — antes arrancaba en la colección `diets`
  // (match por _id del wrapper) y hacía $lookup contra dietdays por
  // localField dietsDay. Ahora arranca directamente en dietdays filtrando por
  // (userId, date), que es justo el índice nuevo — un nivel menos de
  // indirección y sin depender del wrapper. Devuelve la lista de días
  // directamente, no envuelta en {dietDays: [...]}.
  async getDietDaysBetweenDatesByUser(userId, startDate, endDate) {
    const agg = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $sort: {
          date: 1,
        },
      },
      {
              // MVP-trainers F20 (2026-08-01) — pipeline-lookup (en vez del
              // localField/foreignField anterior) para poder resolver un
              // nivel más de profundidad: cada meal.customProducts sigue
              // siendo un array de ObjectId hasta que se resuelve aquí. Sin
              // esto, el consumidor de este endpoint (calendario de dieta del
              // cliente, o el cálculo de adherencia de F20) recibía comidas
              // sin ningún contenido nutricional, aunque el cliente sí las
              // tuviera registradas.
              $lookup: {
                from: "meals",
                let: { mealIds: "$meals" },
                pipeline: [
                  { $match: { $expr: { $in: ["$_id", "$$mealIds"] } } },
                  {
                    $lookup: {
                      from: "customproducts",
                      localField: "customProducts",
                      foreignField: "_id",
                      as: "customProducts",
                    },
                  },
                ],
          as: "meals",
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          date: 1,
          notes: 1,
          skipped: 1,
          meals: {
            _id: 1,
            name: 1,
            notes: 1,
            customProducts: {
              quantity: 1,
              energyKcal100g: 1,
              protein100g: 1,
              carbohydrates100g: 1,
              fat100g: 1,
            },
          },
        },
      },
    ];

    return await dietDaySchema.aggregate(agg);
  },

  // F20-bis — a diferencia de getDietDaysBetweenDatesByIdDiet (aggregate con
  // $project deliberadamente estrecho, compartido con el calendario de peso
  // del propio cliente), esta usa la API estándar de Mongoose para que el
  // plugin mongoose-autopopulate poble en cascada TODO el árbol
  // (meals -> customProducts/customRecipes -> recipe -> recipe.customProducts,
  // addedCustomProducts, modifiedBaseCustomProducts) sin tener que replicar
  // ese árbol a mano en un pipeline de aggregate. Necesario para que
  // diet-days-nutrition-util.js pueda calcular kcal de recetas y
  // cumplimiento por item.
  async getFullyPopulatedDietDaysForUser(userId, startDate, endDate) {
    return dietDaySchema
      .find({
        userId,
        date: { $gte: startDate, $lte: endDate },
      })
      .sort({ date: 1 });
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

  // Crea dietDay con meals. Antes, además de crearlo, lo enganchaba al array
  // diets.dietsDay; ahora el vínculo con el usuario es el propio userId del
  // documento, así que no hay segundo paso que pueda quedar a medias.
  async createDietDayOnNew(userId, dietDay) {
    return this.createDietDay({ ...dietDay, userId });
  },

  // Crea dietDay con meals y añade custom product
  async createCustomProductOnNewDietDay(
    customProduct,
    indexMeal,
    _legacyDietId, // ignorado: el dueño es idUser (se mantiene la firma para no tocar la ruta pública)
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
      // Creación dietDay ya con dueño. Antes había que engancharlo a la Diet
      // y RELEER el día desde el wrapper actualizado solo para tenerlo con
      // las meals pobladas; ahora se relee el propio día, sin intermediario.
      const created = await this.createDietDay({ ...dietDay, userId: idUser });
      let dietDayDoc = (await dietDaySchema.findById(created._id)).toObject();
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
    userId,
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
      // Creación dietDay ya con dueño (ver comentario en la variante de
      // producto: se relee el día, no el wrapper).
      const created = await this.createDietDay({ ...dietDay, userId });
      let dietDayDoc = (await dietDaySchema.findById(created._id)).toObject();
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
      const dietDayDoc = await dietDaySchema.create({ ...dietDay, userId: idUser });

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

  async updateDietDay(id, { name, date, meals, notes }) {
    const dietDay = { name, date, meals, notes };

    const update = { $set: { name, date, meals } };

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

  // Fase 9 — método angosto y dedicado (a diferencia de updateDietDay de
  // arriba, que confía en req.params.id sin comprobar propiedad): el llamador
  // SIEMPRE debe haber resuelto el dietDayId vía resolveOwnedDietDay(userId,
  // date) antes de llamar a esto, nunca aceptar un id suelto del cliente.
  async setMenuName(dietDayId, menuName) {
    return dietDaySchema.findByIdAndUpdate(dietDayId, { $set: { menuName } }, { new: true });
  },

  // TASK-044 (MASTER_BACKLOG.md) — cuenta días en los que el cliente nunca
  // eligió menú (DietDay.menuName sigue null) dentro de [startDate, endDate].
  // Antes cargaba el wrapper Diet entero (autopoblado) para filtrar en
  // memoria; ahora lo cuenta la propia base sobre el índice (userId, date).
  async countDaysWithoutChoice(userId, startDate, endDate) {
    return dietDaySchema.countDocuments({
      userId,
      date: { $gte: startDate, $lte: endDate },
      $or: [{ menuName: null }, { menuName: { $exists: false } }],
    });
  },

  async pasteDietDayByUser(userId, dietDayClipboard, dietDayToPaste) {
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
      delete newDietDay.weight;
      newDietDay.meals = mealsToCreate;
      newDietDay.date = dietDayToPaste.date;

      const doc6 = await dietDaySchema.create({ ...newDietDay, userId });

      return doc6;
    } catch (err) {
      throw err;
    }
  },

  // Sin wrapper no hay que desenganchar de ningún array: borrar el día ES
  // quitarlo de la dieta del usuario. El hook deleteOne de DietDay sigue
  // arrastrando sus Meals (y estas su contenido).
  async deleteDietDay(idDietDay) {
    try {
      return await dietDaySchema.deleteOne({ _id: idDietDay });
    } catch (err) {
      throw err;
    }
  },
};
