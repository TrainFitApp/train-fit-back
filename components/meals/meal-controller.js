const mealService = require("./meal-service");

module.exports = {
  async getMeals(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const meals = await mealService.findAll(page, limit);
    return res.send(meals);
  },

  async getMeal(req, res) {
    const meal = await mealService.findById(req.params.id);
    if (!meal) return res.sendStatus(404);
    return res.send(meal);
  },

  async createMeal(req, res) {
    const meal = await mealService.createMeal(req.body);

    return res.send(meal);
  },

  async searchAllWithFilters(req, res) {
    const page = req.body.page || 0;
    const limit = 7;
    const list = await mealService.searchAllWithFilters(
      page,
      limit,
      req.body.search,
      req.body.ownFilter,
      req.body.recipeFilter,
      req.body.shieldFilter,
      req.body.favFilter,
      req.body.userId,
    );
    return res.send(list);
  },

  async addMealProduct(req, res) {
    const meal = await mealService.addMealProduct(
      req.params.idMeal,
      req.params.idProduct,
    );

    return res.send(meal);
  },

  // async addMealCustomRecipe(req, res) {
  //   const meal = await mealService.addMealCustomRecipe(req.body.mealId, req.body.recipeId);

  //   return res.send(meal);
  // },

  async updateMeal(req, res) {
    // if (!req.body.name) return res.sendStatus(400);
    // if (!req.body.products) return res.sendStatus(400);

    // const meal = await mealService.findById(req.params._id);
    // if (!meal) return res.sendStatus(404);

    const meal = await mealService.updateMeal({
      id: req.body._id,
      name: req.body.name,
      products: req.body.customProducts,
      notes: req.body.notes,
    });

    return res.send(meal);
  },

  async pasteMeal(req, res) {
    const meal = await mealService.pasteMeal(
      req.body.meals.mealClipboard,
      req.body.meals.mealToPaste,
      req.body.merge,
    );

    return res.send(meal);
  },

  async modifyMeal(req, res) {
    const meal = await mealService.modifyMeal(req.body);

    return res.send(meal);
  },

  async deleteMeal(req, res) {
    await mealService.deleteMeal(req.param.id);
    res.sendStatus(204);
  },

  async deleteMealProduct(req, res) {
    const meal = await mealService.deleteMealProduct(
      req.params.idmeal,
      req.params.idproduct,
    );

    return res.send(meal);
  },

  async deleteMealCustomRecipe(req, res) {
    const meal = await mealService.deleteMealCustomRecipe(
      req.params.idmeal,
      req.params.idCustomRecipe,
    );

    return res.send(meal);
  },

  async deleteMealCustomProducts(req, res) {
    const meal = await mealService.deleteMealCustomProducts(req.params.id);

    return res.send(meal);
  },

  async deleteMealCustomRecipes(req, res) {
    const meal = await mealService.deleteMealCustomRecipes(req.params.id);

    return res.send(meal);
  },

  // CustomRecipeInstance methods
  async addMealCustomRecipeInstance(req, res) {
    try {
      const meal = await mealService.addMealCustomRecipeInstance(
        req.params.idMeal,
        req.params.idCustomRecipeInstance,
      );
      return res.json(meal);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },

  async deleteMealCustomRecipeInstance(req, res) {
    try {
      const meal = await mealService.deleteMealCustomRecipeInstance(
        req.params.idMeal,
        req.params.idCustomRecipeInstance,
      );
      return res.json(meal);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },

  async deleteMealCustomRecipeInstances(req, res) {
    try {
      const meal = await mealService.deleteMealCustomRecipeInstances(
        req.params.id,
      );
      return res.json(meal);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  },
};
