const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getMeals);
router.getAsync("/:id", auth(["admin", "user"]), controller.getMeal);
router.postAsync("/", auth(["admin", "user"]), controller.createMeal);
router.postAsync(
  "/search/all",
  auth(["admin", "user"]),
  controller.searchAllWithFilters,
);
// router.putAsync('/add/customrecipe/to/meal', controller.addMealCustomRecipe);
router.putAsync(
  "/:idMeal/:idProduct",
  auth(["admin", "user"]),
  controller.addMealProduct,
);
router.putAsync("/paste", auth(["admin", "user"]), controller.pasteMeal);
router.putAsync(
  "/modify/one/simple",
  auth(["admin", "user"]),
  controller.modifyMeal,
);
router.putAsync(
  "/update/all/meal/fields",
  auth(["admin", "user"]),
  controller.updateMeal,
);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteMeal);
router.deleteAsync(
  "/:idmeal/:idproduct",
  auth(["admin", "user"]),
  controller.deleteMealProduct,
);
router.deleteAsync(
  "/customrecipe/:idmeal/:idCustomRecipe",
  auth(["admin", "user"]),
  controller.deleteMealCustomRecipe,
);
router.deleteAsync(
  "/all/customproducts/:id",
  auth(["admin", "user"]),
  controller.deleteMealCustomProducts,
);
router.deleteAsync(
  "/all/customrecipes/:id",
  auth(["admin", "user"]),
  controller.deleteMealCustomRecipes,
);

router.postAsync(
  "/:idMeal/customrecipes/:idCustomRecipe",
  auth(["admin", "user"]),
  controller.addMealCustomRecipe,
);
router.deleteAsync(
  "/customrecipe/:idMeal/:idCustomRecipe",
  auth(["admin", "user"]),
  controller.deleteMealCustomRecipeRef,
);
router.deleteAsync(
  "/all/customrecipesref/:id",
  auth(["admin", "user"]),
  controller.deleteMealCustomRecipesRef,
);

// TAREA 1 (coach-tab) — marcar/desmarcar cumplimiento, nunca protegido por
// assertMealEditable (ver meal-controller.js#setMealCompleted).
router.patchAsync(
  "/:id/completed",
  auth(["admin", "user"]),
  controller.setMealCompleted,
);

module.exports = router;
