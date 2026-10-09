const mealDao = require("./meal-dao");
const mealAlternatives = require("./meal-alternatives");
const customProductDao = require("../customProducts/custom-product-dao");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");

// TAREA 1 (coach-tab) — única comprobación de "¿puede el cliente editar
// libremente esta comida?" en todo el módulo. Una comida pautada por un
// profesional (assignedByTrainerId) solo puede cambiar de composición por
// una vía controlada por ese profesional (prescribeMeal o las opciones de su
// plan), nunca por edición directa del cliente sobre sus productos/recetas.
class MealProtectedError extends Error {
  constructor() {
    super("Esta comida fue pautada por tu profesional. Pídele un cambio en vez de editarla directamente.");
    this.code = "MEAL_PROTECTED";
    this.status = 403;
    this.publicMessage = this.message;
  }
}

// Reutilizada tal cual para cada CustomProduct/CustomRecipe de la comida
// (meal-controller.js): mismo campo, mismo significado ("¿esto lo compuso un
// profesional?"), no hace falta una función aparte solo porque el objeto no
// sea un Meal.
function assertMealEditable(meal) {
  if (meal?.assignedByTrainerId) {
    throw new MealProtectedError();
  }
}

module.exports = {
  MealProtectedError,
  assertMealEditable,

  async findById(id) {
    return mealDao.findById(id);
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
    recentIds = [],
    authUserId = null,
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
      recentIds,
      authUserId,
    );
  },

  async modifyMeal(id, patch) {
    return mealDao.modifyMeal(id, patch);
  },

  async pasteMeal(mealClipboard, mealToPaste, merge, trainerId = null) {
    return mealDao.pasteMeal(mealClipboard, mealToPaste, merge, trainerId);
  },

  async deleteMealProduct(idMeal, idProduct) {
    return mealDao.deleteMealProduct(idMeal, idProduct);
  },

  async deleteMealCustomProducts(id) {
    return mealDao.deleteMealCustomProducts(id);
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

  // TAREA 1 — marca esta comida como pautada por el profesional, tras
  // pasteMeal (prescribeMeal). Permanente, mismo criterio que
  // Table.assignedByTrainerId — no se borra al revocar.
  async markAssignedByTrainer(id, trainerId) {
    return mealDao.markAssignedByTrainer(id, trainerId);
  },

  // Alimento nuevo en la comida (el Product inline, si llega, se guarda a
  // nombre de `userId`).
  async addCustomProduct(mealId, customProduct, userId) {
    return customProductDao.createCustomProductAndAddToMeal(mealId, customProduct, userId);
  },

  async updateCustomProduct(customProductId, changes) {
    return customProductDao.updateCustomProduct({ ...changes, _id: customProductId });
  },

  // El cliente elige (o cambia) una de las opciones de la comida.
  async chooseAlternative(mealId, chosenIndex) {
    return mealAlternatives.choose(mealId, chosenIndex);
  },

  // Pautados a nivel de item — marcar/desmarcar consumido nunca pasa por
  // assertMealEditable: seguimiento y composición son conceptos distintos.
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
