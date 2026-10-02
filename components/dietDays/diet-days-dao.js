const dietDaySchema = require("./diet-days-schema");
const mealSchema = require("../meals/meal-schema");
const mealModel = require("../meals/meal-service");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const customProductDao = require("../customProducts/custom-product-dao");
const { default: mongoose } = require("mongoose");
const dietDaysUtil = require("./diet-days-util");

const DUPLICATE_KEY = 11000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `status` + `publicMessage` para que middleware/index.js#errorHandler lo
// devuelva como 400 con su mensaje, en vez de saneárlo como un 500.
const badRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
};

// `dietDay.meals` llega con ObjectId sueltos cuando el día se acaba de crear
// y con las Meal ya pobladas (autopopulate) cuando se leyó de BD: el hueco se
// localiza igual en los dos casos.
const mealIdAt = (dietDay, indexMeal) => {
  const mealRef = (dietDay?.meals || [])[Number(indexMeal)];
  if (!mealRef) throw badRequest("Esa comida no existe en el día indicado");

  return (mealRef._id || mealRef).toString();
};

const toPlainPayload = (value) => {
  const payload = value?.toObject ? value.toObject() : { ...(value || {}) };
  delete payload._id;
  return payload;
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

  // Lista de la compra — solo el menú elegido y si el día está saltado, sin
  // el árbol de autopopulate.
  async listMenuMarks(userId, startDate, endDate) {
    return dietDaySchema
      .find({ userId, date: { $gte: startDate, $lte: endDate } })
      .select("date menuName skipped")
      .lean();
  },

  // Coach Pro — días de VARIOS usuarios con solo lo que lee
  // diet-days-nutrition-util#computeRangeAdherence: Meal.completed y, de cada
  // item, assignedByTrainerId + consumed. Sustituye, para las alertas y la
  // Cartera, a un getFullyPopulatedDietDaysForUser por cliente y en serie,
  // que arrastraba el árbol entero de autopopulate (productos, recetas,
  // ingredientes) para contar marcas. Una agregación para toda la cartera.
  // Sin orden: la adherencia de un rango no depende de él.
  async listTrackingDaysForUsers(userIds, startDate, endDate) {
    if (!userIds.length) return [];
    const itemFields = [{ $project: { assignedByTrainerId: 1, consumed: 1 } }];
    return dietDaySchema.aggregate([
      {
        $match: {
          userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          date: { $gte: startDate, $lte: endDate },
        },
      },
      { $project: { userId: 1, date: 1, meals: 1 } },
      {
        $lookup: {
          from: "meals",
          localField: "meals",
          foreignField: "_id",
          as: "meals",
          pipeline: [
            { $project: { completed: 1, customProducts: 1, customRecipes: 1 } },
            {
              $lookup: {
                from: "customproducts",
                localField: "customProducts",
                foreignField: "_id",
                as: "customProducts",
                pipeline: itemFields,
              },
            },
            {
              $lookup: {
                from: "customrecipes",
                localField: "customRecipes",
                foreignField: "_id",
                as: "customRecipes",
                pipeline: itemFields,
              },
            },
          ],
        },
      },
    ]);
  },

  // ÚNICA vía de creación de un DietDay en todo el backend (2026-10).
  // Idempotente por (userId, date): si el día ya existe lo devuelve tal cual
  // en vez de crear un segundo. Antes cada acción que podía "estrenar" un día
  // (añadir producto, añadir receta, apuntar peso, pegar un día, escribir una
  // nota) hacía su propio create a ciegas, así que bastaba con que el día ya
  // estuviera en BD —o con dos peticiones a la vez— para acabar con dos
  // documentos de la misma fecha, uno de ellos invisible para el cliente.
  //
  // La carrera de verdad (dos peticiones simultáneas del mismo cliente para
  // la misma fecha, p. ej. dos checkbox seguidos del buscador de alimentos) la
  // corta el índice único {userId, date} de diet-days-schema.js: la perdedora
  // recibe E11000, tira las Meal que acababa de crear y relee la ganadora.
  async ensureDietDay(userId, date) {
    // Un día con fecha basura dejaría de encontrarse por (userId, date), que
    // es la clave de todo el módulo: se corta aquí, en el único sitio que
    // crea días, y no en cada llamador.
    if (!userId || !ISO_DATE.test((date || "").toString())) {
      throw badRequest("Fecha inválida (YYYY-MM-DD)");
    }

    const existing = await dietDaySchema.findOne({ userId, date });
    if (existing) return { dietDay: existing, created: false };

    const meals = await mealSchema.insertMany(
      dietDaysUtil.getStandardDietDay(date).meals,
    );
    const mealIds = meals.map((meal) => meal._id);

    try {
      const dietDay = await dietDaySchema.create({ userId, date, meals: mealIds });
      return { dietDay, created: true };
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY) throw error;

      await mealSchema.deleteMany({ _id: { $in: mealIds } });
      return {
        dietDay: await dietDaySchema.findOne({ userId, date }),
        created: false,
      };
    }
  },

  // Añade un producto al hueco `indexMeal` de un día YA resuelto (ver
  // diet-day-resolver.js#resolveOwnedDietDay): el día existe siempre, así que
  // esto ya no distingue entre "día nuevo" y "día de siempre" — era esa
  // bifurcación la que duplicaba días. Reutiliza el mismo DAO que la vía
  // normal (customProducts/custom-product-dao.js), así que un producto creado
  // al estrenar el día queda EXACTAMENTE igual que cualquier otro (incluido
  // `mealId`, que la vía vieja no rellenaba, y el Product inline unificado).
  async addCustomProductToMeal(dietDay, indexMeal, customProduct, userId) {
    const mealId = mealIdAt(dietDay, indexMeal);
    await customProductDao.createCustomProductAndAddToMeal(
      mealId,
      customProduct,
      userId,
    );
    return dietDaySchema.findById(dietDay._id);
  },

  // Variante receta de addCustomProductToMeal. La usan tanto la ruta de
  // dietDays como recipes/recipe-dao.js#composeRecipe (crear receta y
  // pautársela de una sola llamada).
  async addCustomRecipeToMeal(dietDay, indexMeal, customRecipe) {
    const mealId = mealIdAt(dietDay, indexMeal);
    const customRecipeDoc = await customRecipeDao.createCustomRecipe(
      toPlainPayload(customRecipe),
    );
    await mealModel.addMealCustomRecipe(mealId, customRecipeDoc._id.toString());
    return dietDaySchema.findById(dietDay._id);
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

  // Nota del día. Angosto a propósito (2026-10): antes aceptaba `date` y
  // `meals` del body, así que una llamada podía mover un día a una fecha que
  // YA tenía día (duplicado) o reescribir su array de comidas desde el
  // cliente. La nota es lo único que escribe la app por aquí; el día se
  // resuelve por (userId, date), nunca por un _id suelto.
  async setNotes(userId, date, notes) {
    const trimmed = (notes || "").toString().trim();
    const update = trimmed ? { $set: { notes: trimmed } } : { $unset: { notes: "" } };

    return dietDaySchema.findOneAndUpdate({ userId, date }, update, { new: true });
  },

  // Fase 9 — el llamador SIEMPRE debe haber resuelto el dietDayId vía
  // resolveOwnedDietDay(userId, date) antes de llamar a esto, nunca aceptar un
  // id suelto del cliente.
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
    // El día destino, primero: así una fecha inválida corta antes de haber
    // creado nada, y lo que se pega va siempre sobre el día que YA es de esa
    // fecha (antes se borraba por un _id del body y se creaba otro, con lo que
    // una fecha que ya tenía día acababa con dos).
    const { dietDay } = await this.ensureDietDay(userId, dietDayToPaste?.date);
    const normalizeId = (value) => value?._id || value;
    const toPlainObject = (value) =>
      value?.toObject ? value.toObject() : { ...value };
    // Lo que pega el cliente es suyo: nunca hereda del portapapeles la marca
    // de pautado ni el "tomado" (ver meal-dao.js#pasteMeal).
    const cloneCustomProductPayload = (value) => {
      const payload = toPlainObject(value);
      delete payload._id;
      delete payload.assignedByTrainerId;
      delete payload.assignedQuantity;
      delete payload.consumed;
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

      const customProductsToCreate = (mealObj.customProducts || []).map(cloneCustomProductPayload);

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

    // Se le sustituyen las comidas al día destino, que es siempre el mismo
    // documento: no hay duplicado posible, y `menuName`/`skipped` del destino
    // se conservan (no pertenecen al día copiado).
    const previousMealIds = (dietDay.meals || []).map((meal) => meal._id || meal);

    const pastedNotes = (dietDayClipboard.notes || "").toString().trim();
    await dietDaySchema.updateOne(
      { _id: dietDay._id },
      pastedNotes
        ? { $set: { meals: mealsToCreate, notes: pastedNotes } }
        : { $set: { meals: mealsToCreate }, $unset: { notes: "" } },
    );
    // Arrastra el contenido de las comidas sustituidas (hook deleteMany de
    // Meal), igual que hacía el borrado del día entero.
    await mealSchema.deleteMany({ _id: { $in: previousMealIds } });

    return dietDaySchema.findById(dietDay._id);
  },

  // Sin wrapper no hay que desenganchar de ningún array: borrar el día ES
  // quitarlo de la dieta del usuario. El hook deleteOne de DietDay sigue
  // arrastrando sus Meals (y estas su contenido).
  async deleteDietDay(idDietDay, userId) {
    try {
      return await dietDaySchema.deleteOne({ _id: idDietDay, userId });
    } catch (err) {
      throw err;
    }
  },
};
