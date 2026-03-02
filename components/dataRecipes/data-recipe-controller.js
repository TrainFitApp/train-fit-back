const model = require("./data-recipe-model");

/**
 * DataRecipe Controller
 * Handles HTTP requests for DataRecipe operations
 * DataRecipe is a wrapper for Recipe with consumption data (quantity, quantityCooked)
 */

// Get a DataRecipe by ID
async function getById(req, res, next) {
  try {
    const dataRecipe = await model.getById(req.params.id);
    if (!dataRecipe) {
      return res.status(404).json({ message: "DataRecipe no encontrado" });
    }
    res.json(dataRecipe);
  } catch (error) {
    next(error);
  }
}

// Create a new DataRecipe
async function create(req, res, next) {
  try {
    const dataRecipeData = {
      recipe: req.body.recipe,
      quantity: req.body.quantity,
      quantityCooked: req.body.quantityCooked,
    };

    const dataRecipe = await model.create(dataRecipeData);
    res.status(201).json(dataRecipe);
  } catch (error) {
    next(error);
  }
}

// Update a DataRecipe
async function update(req, res, next) {
  try {
    const updateData = {};

    if (req.body.recipe !== undefined) updateData.recipe = req.body.recipe;
    if (req.body.quantity !== undefined)
      updateData.quantity = req.body.quantity;
    if (req.body.quantityCooked !== undefined)
      updateData.quantityCooked = req.body.quantityCooked;

    const dataRecipe = await model.update(req.params.id, updateData);
    if (!dataRecipe) {
      return res.status(404).json({ message: "DataRecipe no encontrado" });
    }
    res.json(dataRecipe);
  } catch (error) {
    next(error);
  }
}

// Delete a DataRecipe
async function remove(req, res, next) {
  try {
    const dataRecipe = await model.delete(req.params.id);
    if (!dataRecipe) {
      return res.status(404).json({ message: "DataRecipe no encontrado" });
    }
    res.json({ message: "DataRecipe eliminado correctamente" });
  } catch (error) {
    next(error);
  }
}

// Search recipes (verified or user's own)
async function searchRecipes(req, res, next) {
  try {
    const userId = req.user.id;
    const searchTerm = req.query.q || "";
    const recipes = await model.searchRecipes(searchTerm, userId);
    res.json(recipes);
  } catch (error) {
    next(error);
  }
}

// Get user's own recipes
async function getUserRecipes(req, res, next) {
  try {
    const userId = req.user.id;
    const recipes = await model.getUserRecipes(userId);
    res.json(recipes);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getById,
  create,
  update,
  remove,
  searchRecipes,
  getUserRecipes,
};
