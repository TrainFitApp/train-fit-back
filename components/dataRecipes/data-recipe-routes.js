const express = require("express");
const router = express.Router();
const controller = require("./data-recipe-controller");
const { validateAuth } = require("../../middleware");

/**
 * DataRecipe Routes
 * DataRecipe is a wrapper for Recipe with consumption data
 */

// All routes require authentication
router.use(validateAuth);

// Recipe search and listing (must be before /:id routes)
router.get("/search/recipes", controller.searchRecipes);
router.get("/user/recipes", controller.getUserRecipes);

// CRUD operations for DataRecipe
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
