const express = require("express");
const router = express.Router();
const controller = require("./recipe-controller");
const { validateAuth } = require("../../middleware");

// All routes require authentication
router.use(validateAuth);

// Search and filter routes (must be before /:id)
router.get("/search", controller.searchRecipes);
router.get("/user", controller.getUserRecipes);
router.get("/verified", controller.getVerifiedRecipes);
router.get("/favorites", controller.getFavoriteRecipes);

// CRUD operations
router.get("/:id", controller.getRecipeById);
router.post("/", controller.createRecipe);
router.post("/compose", controller.composeRecipe);
router.put("/:id", controller.updateRecipe);
router.delete("/:id", controller.deleteRecipe);

// Favorite toggle
router.post("/:id/favorite", controller.toggleFavoriteRecipe);

// CustomProduct management within Recipe
router.post(
  "/:idRecipe/customproducts/:idCustomProduct",
  controller.addRecipeCustomProduct,
);
router.delete(
  "/:idRecipe/customproducts/:idCustomProduct",
  controller.removeRecipeCustomProduct,
);

module.exports = router;
