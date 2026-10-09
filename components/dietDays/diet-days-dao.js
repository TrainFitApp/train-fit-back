const dietDaySchema = require("./diet-days-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const customProductDao = require("../customProducts/custom-product-dao");
const mealStore = require("../meals/meal-store");
const { cloneClipboardContent, keptOnPaste } = require("../meals/meal-dao");
const { mutateDocument } = require("../util/embedded-store");
const { default: mongoose } = require("mongoose");
const dietDaysUtil = require("./diet-days-util");

// Días de dieta con sus comidas, alimentos y recetas EMBEBIDOS (2026-10).
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

// Id de la comida del hueco `indexMeal` (las comidas van embebidas y en el
// orden de los huecos).
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
  // Calendario del cliente (y adherencia): solo los macros que guarda cada
  // alimento, sin poblar nada. Las comidas van embebidas y en su orden.
  async getDietDaysBetweenDatesByUser(userId, startDate, endDate) {
    return dietDaySchema.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDate, $lte: endDate },
        },
      },
      { $sort: { date: 1 } },
      {
        $project: {
          _id: 1,
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
    ]);
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
  // diet-days-nutrition-util#computeRangeAdherence: de cada item,
  // assignedByTrainerId + consumed. Sustituye, para las alertas y la
  // Cartera, a un getFullyPopulatedDietDaysForUser por cliente y en serie,
  // que arrastraba el árbol entero de autopopulate (productos, recetas,
  // ingredientes) para contar marcas. Una agregación para toda la cartera.
  // Sin orden: la adherencia de un rango no depende de él.
  async listTrackingDaysForUsers(userIds, startDate, endDate) {
    if (!userIds.length) return [];
    return dietDaySchema.aggregate([
      {
        $match: {
          userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $project: {
          userId: 1,
          date: 1,
          meals: {
            _id: 1,
            customProducts: { _id: 1, assignedByTrainerId: 1, consumed: 1 },
            customRecipes: { _id: 1, assignedByTrainerId: 1, consumed: 1 },
          },
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
  // recibe E11000 y relee la ganadora (las comidas van dentro del día: no
  // queda nada suelto que limpiar).
  async ensureDietDay(userId, date) {
    // Un día con fecha basura dejaría de encontrarse por (userId, date), que
    // es la clave de todo el módulo: se corta aquí, en el único sitio que
    // crea días, y no en cada llamador.
    if (!userId || !ISO_DATE.test((date || "").toString())) {
      throw badRequest("Fecha inválida (YYYY-MM-DD)");
    }

    const existing = await dietDaySchema.findOne({ userId, date });
    if (existing) return { dietDay: existing, created: false };

    try {
      const dietDay = await dietDaySchema.create({
        userId,
        date,
        meals: dietDaysUtil.getStandardDietDay(date).meals,
      });
      return { dietDay, created: true };
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY) throw error;
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
  // dietDays como recipes/recipe-service.js#composeRecipe (crear receta y
  // pautársela de una sola llamada).
  async addCustomRecipeToMeal(dietDay, indexMeal, customRecipe) {
    const mealId = mealIdAt(dietDay, indexMeal);
    const built = await customRecipeDao.createCustomRecipe(toPlainPayload(customRecipe));
    await mealStore.pushToMeal(mealId, "customRecipes", built);
    return dietDaySchema.findById(dietDay._id);
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

  // Pega un día sobre el de esa fecha, hueco a hueco (la posición es el
  // hueco, ver diet-day-resolver.js): en cada comida lo del cliente se
  // sustituye por la copia de la misma comida del día copiado, y lo pautado
  // del destino se queda donde está (meal-dao.js#keptOnPaste). Una comida
  // pautada entera no se toca. Las comidas conservan su id, nombre y
  // opciones; `menuName`/`skipped` del día destino también.
  async pasteDietDayByUser(userId, dietDayClipboard, date) {
    // Lo que se pega va siempre sobre el día que YA es de esa fecha.
    const { dietDay } = await this.ensureDietDay(userId, date);
    const toPlainObject = (value) => (value?.toObject ? value.toObject() : { ...value });

    // Lo que pega el cliente es suyo: nunca hereda del portapapeles la marca
    // de pautado ni el "tomado" (ver meal-dao.js#cloneClipboardContent).
    const sources = [];
    for (const mealRef of dietDayClipboard?.meals || []) {
      const mealObj = toPlainObject(mealRef);
      sources.push({ notes: (mealObj.notes || "").toString().trim(), ...(await cloneClipboardContent(mealObj)) });
    }

    const pastedNotes = (dietDayClipboard?.notes || "").toString().trim();
    await mutateDocument(dietDaySchema, { _id: dietDay._id }, (day) => {
      const meals = (day.meals || []).map((meal, index) => {
        if (meal.assignedByTrainerId) return meal;
        const source = sources[index] || { notes: "", customProducts: [], customRecipes: [] };
        const next = {
          ...meal,
          customProducts: [...keptOnPaste(meal.customProducts), ...source.customProducts],
          customRecipes: [...keptOnPaste(meal.customRecipes), ...source.customRecipes],
        };
        if (source.notes) next.notes = source.notes;
        else delete next.notes;
        return next;
      });
      return pastedNotes ? { meals, notes: pastedNotes } : { meals };
    });
    if (!pastedNotes) await dietDaySchema.updateOne({ _id: dietDay._id }, { $unset: { notes: "" }, $inc: { __v: 1 } });

    return dietDaySchema.findById(dietDay._id);
  },

  // Nota fijada de la pantalla de dieta: vive en el usuario
  // (User.dietPinnedNote). Vacía = sin nota.
  async setPinnedNote(userId, notes) {
    const user = await mongoose
      .model("User")
      .findByIdAndUpdate(userId, notes ? { $set: { dietPinnedNote: notes } } : { $unset: { dietPinnedNote: 1 } }, { new: true })
      .select("dietPinnedNote")
      .lean();
    return user?.dietPinnedNote || "";
  },

  // Borrar el día ES quitarlo de la dieta del usuario: sus comidas van dentro.
  async deleteDietDay(userId, date) {
    return dietDaySchema.deleteOne({ userId, date });
  },
};
