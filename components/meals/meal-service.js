const mealDao = require("./meal-dao");

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

function assertMealEditable(meal) {
  if (meal?.assignedByTrainerId) {
    throw new MealProtectedError();
  }
}

module.exports = {
  MealProtectedError,
  assertMealEditable,
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

  async pasteMeal(mealClipboard, mealToPaste, merge) {
    return mealDao.pasteMeal(mealClipboard, mealToPaste, merge);
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
  // Table/NutritionalGoal.assignedByTrainerId — no se borra al revocar.
  async markAssignedByTrainer(id, trainerId) {
    return mealDao.markAssignedByTrainer(id, trainerId);
  },
};
