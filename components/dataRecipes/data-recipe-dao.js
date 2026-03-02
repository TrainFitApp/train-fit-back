const dataRecipeSchema = require("./data-recipe-schema");
const recipeSchema = require("../recipes/recipe-schema");
const mealSchema = require("../meals/meal-schema");

module.exports = {
  /**
   * Obtener DataRecipe por ID
   */
  async getById(id) {
    return dataRecipeSchema.findById(id).populate("recipe");
  },

  /**
   * Crear una nueva DataRecipe
   * IMPORTANTE: NO COPIA la receta ni los customProducts
   * Usa REFERENCIAS INMUTABLES para reutilizar datos
   *
   * @param {Object} dataRecipe - { recipeId, quantity?, quantityCooked? }
   * @returns {Promise<Object>} La DataRecipe creada
   */
  async create(dataRecipe) {
    try {
      const recipeId =
        dataRecipe.recipeId || dataRecipe.recipe?._id || dataRecipe.recipe;

      // Validar que la receta existe
      const recipe = await recipeSchema.findById(recipeId);
      if (!recipe) {
        throw new Error(`Recipe not found: ${recipeId}`);
      }

      // Crear la DataRecipe como referencia simple (SIN COPIAR)
      const newDataRecipe = await dataRecipeSchema.create({
        recipe: recipeId, // Solo referencia
        quantity: dataRecipe.quantity,
        quantityCooked: dataRecipe.quantityCooked,
      });

      // Retornar con populate
      return dataRecipeSchema.findById(newDataRecipe._id).populate("recipe");
    } catch (error) {
      throw error;
    }
  },

  /**
   * Actualizar una DataRecipe
   * IMPORTANTE: NO se puede cambiar la referencia a Recipe (es inmutable)
   * Solo se pueden cambiar: quantity, quantityCooked
   */
  async update(id, data) {
    try {
      // Remover 'recipe' si viene en el objeto (no se puede cambiar)
      delete data.recipe;
      delete data._id;

      const updated = await dataRecipeSchema
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .populate("recipe");

      if (!updated) {
        throw new Error(`DataRecipe not found: ${id}`);
      }

      return updated;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Eliminar una DataRecipe
   * También la remueve del Meal si se especifica mealId
   */
  async delete(id, mealId) {
    try {
      // Remover del meal si se proporciona mealId
      if (mealId) {
        await mealSchema.findByIdAndUpdate(mealId, {
          $pull: { dataRecipes: id },
        });
      }

      const deleted = await dataRecipeSchema.findByIdAndDelete(id);

      if (!deleted) {
        throw new Error(`DataRecipe not found: ${id}`);
      }

      return { success: true, deleted };
    } catch (error) {
      throw error;
    }
  },

  /**
   * Obtener todas las DataRecipes de un usuario
   */
  async getUserDataRecipes(userId, page = 0, limit = 20) {
    try {
      const dataRecipes = await dataRecipeSchema
        .find()
        .populate({
          path: "recipe",
          match: { userId: userId },
        })
        .skip(page * limit)
        .limit(limit);

      // Filtrar DataRecipes donde la receta pertenece al usuario
      const filtered = dataRecipes.filter((dr) => dr.recipe);

      return {
        dataRecipes: filtered,
        total: filtered.length,
        page,
        limit,
      };
    } catch (error) {
      throw error;
    }
  },
};
