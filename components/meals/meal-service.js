const mealDao = require("./meal-dao");

module.exports = {
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
};
