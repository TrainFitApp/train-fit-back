const mealDao = require("./meal-dao");
const customProductDao = require("../customProducts/custom-product-dao");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");

// TAREA 1 (coach-tab) — única comprobación de "¿puede el cliente editar
// libremente esta comida?" en todo el módulo. Una comida pautada por un
// profesional (assignedByTrainerId) solo puede cambiar de composición por
// una vía controlada por ese profesional (prescribeMeal/MealProposal), nunca
// por edición directa del cliente sobre sus productos/recetas.
class MealProtectedError extends Error {
  constructor() {
    super("Esta comida fue pautada por tu profesional. Pídele un cambio en vez de editarla directamente.");
    this.code = "MEAL_PROTECTED";
  }
}

// Reutilizada tal cual para CustomProduct/CustomRecipe individuales (ver
// custom-product-controller.js/custom-recipe-controller.js y
// deleteMealProduct/deleteMealCustomRecipe más abajo): mismo campo, mismo
// significado ("¿esto lo compuso un profesional?"), no hace falta una
// función aparte solo porque el objeto no sea un Meal.
function assertMealEditable(meal) {
  if (meal?.assignedByTrainerId) {
    throw new MealProtectedError();
  }
}

// pasteMeal en modo "reemplazar" (merge=false) borra TODO lo que hubiera
// antes en la comida — si esta ya tiene items pautados a nivel individual
// (meal.assignedByTrainerId sigue null porque la comida es "mixta", ver
// meal-dao.js#pasteMeal), un reemplazo se los llevaría por delante sin que
// assertMealEditable (que solo mira el nivel de Meal) lo detecte. En modo
// "combinar" (merge=true) los items existentes sobreviven intactos, así
// que no hace falta esta comprobación extra.
function assertMealPasteAllowed(meal, merge) {
  assertMealEditable(meal);
  if (merge) return;

  const hasProtectedItems =
    (meal?.customProducts || []).some((cp) => cp?.assignedByTrainerId) ||
    (meal?.customRecipes || []).some((cr) => cr?.assignedByTrainerId);
  if (hasProtectedItems) {
    throw new MealProtectedError();
  }
}

// Traduce MealProtectedError a 403 — antes duplicada byte a byte en
// custom-product-controller.js y custom-recipe-controller.js (ninguno de
// los dos pasa por meal-controller.js#handleMealError). Un solo sitio.
function handleProtectedError(res, e) {
  if (e instanceof MealProtectedError) {
    return res.status(403).send({ message: e.message, code: e.code });
  }
  return null;
}

module.exports = {
  MealProtectedError,
  assertMealEditable,
  assertMealPasteAllowed,
  handleProtectedError,
  async findAll(page, limit) {
    return mealDao.findAll(page, limit);
  },

  async findById(id) {
    return mealDao.findById(id);
  },

  async createMeal(meal) {
    return mealDao.createMeal(meal);
  },

  async searchAllWithFilters(
    page,
    limit,
    search,
    ownFilter,
    recipeFilter,
    shieldFilter,
    favFilter,
    userId,
  ) {
    return mealDao.searchAllWithFilters(
      page,
      limit,
      search,
      ownFilter,
      recipeFilter,
      shieldFilter,
      favFilter,
      userId,
    );
  },

  async addMealProduct(idMeal, idProduct) {
    return mealDao.addMealProduct(idMeal, idProduct);
  },

  async addMealCustomRecipe(idMeal, idRecipe) {
    return mealDao.addMealCustomRecipe(idMeal, idRecipe);
  },

  async updateMeal({ id, name, products, notes }) {
    return mealDao.updateMeal({ id, name, products, notes });
  },

  async modifyMeal(meal) {
    return mealDao.modifyMeal(meal);
  },

  async pasteMeal(mealClipboard, mealToPaste, merge, trainerId = null) {
    return mealDao.pasteMeal(mealClipboard, mealToPaste, merge, trainerId);
  },

  async deleteMeal(id) {
    return mealDao.deleteMeal(id);
  },

  async deleteMealProduct(idMeal, idProduct) {
    return mealDao.deleteMealProduct(idMeal, idProduct);
  },

  async deleteMealCustomRecipe(idMeal, idCustomRecipe) {
    return mealDao.deleteMealCustomRecipe(idMeal, idCustomRecipe);
  },

  async deleteMealCustomProducts(id) {
    return mealDao.deleteMealCustomProducts(id);
  },

  async deleteMealCustomRecipes(id) {
    return mealDao.deleteMealCustomRecipes(id);
  },

  async addMealCustomRecipe(idMeal, idCustomRecipe) {
    return mealDao.addMealCustomRecipe(idMeal, idCustomRecipe);
  },

  async deleteMealCustomRecipe(idMeal, idCustomRecipe) {
    return mealDao.deleteMealCustomRecipe(
      idMeal,
      idCustomRecipe,
    );
  },

  async deleteMealCustomRecipes(id) {
    return mealDao.deleteMealCustomRecipes(id);
  },

  // TAREA 1 — marcar/desmarcar cumplimiento. Nunca bloqueado por
  // assertMealEditable: seguimiento y composición son conceptos distintos.
  async setCompleted(id, completed) {
    return mealDao.setCompleted(id, completed);
  },

  // TAREA 1 — marca esta comida como pautada por el profesional, tras
  // pasteMeal (prescribeMeal). Permanente, mismo criterio que
  // Table.assignedByTrainerId — no se borra al revocar.
  async markAssignedByTrainer(id, trainerId) {
    return mealDao.markAssignedByTrainer(id, trainerId);
  },

  // Pautados a nivel de item (TAREA meals pautados) — marcar/desmarcar
  // consumido nunca pasa por assertMealEditable (mismo criterio que
  // setCompleted de arriba).
  async setCustomProductConsumed(id, consumed) {
    return customProductDao.setConsumed(id, consumed);
  },

  async setCustomRecipeConsumed(id, consumed) {
    return customRecipeDao.setConsumed(id, consumed);
  },

  // Cantidad realmente consumida de un producto/receta pautados — mismo
  // criterio que setCustomProductConsumed/setCustomRecipeConsumed de
  // arriba: nunca bloqueado por assertMealEditable (seguimiento, no
  // composición). Es la vía por la que el cliente puede ajustar CUÁNTO de
  // lo pautado tomó, sin poder tocar qué es ni de qué está hecho.
  async setCustomProductQuantity(id, quantity) {
    return customProductDao.setQuantity(id, quantity);
  },

  async setCustomRecipeQuantity(id, quantity) {
    return customRecipeDao.setQuantity(id, quantity);
  },
};
