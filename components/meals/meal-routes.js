const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-controller");

const router = express.Router();

// Una comida vive dentro de su día (DietDay.meals[]) y sus alimentos y
// recetas dentro de ella: todo se direcciona por la comida.

// El entrenador también busca productos y recetas para pautar comida (solo
// lectura; ver meal-controller.js#search).
router.postAsync("/search", auth(["admin", "user", "trainer"]), controller.search);

router.getAsync("/:id", auth(["admin", "user"]), controller.getMeal);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateMeal);
router.putAsync("/:id/paste", auth(["admin", "user"]), controller.pasteMeal);
router.putAsync("/:id/alternative", auth(["admin", "user"]), controller.chooseAlternative);

router.postAsync("/:id/customproducts", auth(["admin", "user"]), controller.addCustomProduct);
router.deleteAsync("/:id/customproducts", auth(["admin", "user"]), controller.deleteAllCustomProducts);
router.putAsync("/:id/customproducts/:itemId", auth(["admin", "user"]), controller.updateCustomProduct);
router.deleteAsync("/:id/customproducts/:itemId", auth(["admin", "user"]), controller.deleteCustomProduct);
router.patchAsync("/:id/customproducts/:itemId/consumed", auth(["admin", "user"]), controller.setCustomProductConsumed);
router.patchAsync("/:id/customproducts/:itemId/quantity", auth(["admin", "user"]), controller.setCustomProductQuantity);

router.deleteAsync("/:id/customrecipes", auth(["admin", "user"]), controller.deleteAllCustomRecipes);
router.deleteAsync("/:id/customrecipes/:itemId", auth(["admin", "user"]), controller.deleteCustomRecipe);
router.patchAsync("/:id/customrecipes/:itemId/consumed", auth(["admin", "user"]), controller.setCustomRecipeConsumed);
router.patchAsync("/:id/customrecipes/:itemId/quantity", auth(["admin", "user"]), controller.setCustomRecipeQuantity);

module.exports = router;
