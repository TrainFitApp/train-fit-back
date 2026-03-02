/**
 * CustomRecipeInstance DAO
 * Gestiona instancias de recetas en meals
 * IMPORTANTE: No copia datos, solo guarda referencias y overrides
 */

const customRecipeSchema = require("./custom-recipe-schema");
const dataRecipeDao = require("../dataRecipes/data-recipe-dao");
const recipeMergeService = require("../recipes/recipe-merge.service");

module.exports = {
  /**
   * Obtener CustomRecipeInstance por ID
   */
  async getById(id) {
    return customRecipeSchema.findById(id).populate({
      path: "dataRecipe",
      populate: {
        path: "recipe",
        populate: {
          path: "customProducts",
        },
      },
    });
  },

  /**
   * Crear una CustomRecipeInstance (añadir receta a una meal)
   * @param {Object} instanceData - { dataRecipeId, quantity, customProductsOverrides?, additionalCustomProducts? }
   * @returns {Promise<Object>} La instancia creada
   */
  async create(instanceData) {
    try {
      console.log("🔍 DAO create received:", instanceData);

      // Validar estructura
      recipeMergeService.validateCustomRecipeInstance(instanceData);
      console.log("✅ Validation passed");

      const dataRecipeRef =
        instanceData.dataRecipeId || instanceData.dataRecipe;
      console.log("🔗 DataRecipe reference:", dataRecipeRef);

      // Crear la instancia
      const newInstance = await customRecipeSchema.create({
        dataRecipe: dataRecipeRef,
        quantity: instanceData.quantity,
        customProductsOverrides: instanceData.customProductsOverrides || [],
        additionalCustomProducts: instanceData.additionalCustomProducts || [],
      });

      console.log("✅ Instance created in DB:", newInstance._id);

      // Retornar con populate
      return this.getById(newInstance._id);
    } catch (error) {
      console.error("❌ DAO create error:", error.message);
      throw new Error(`Error creating CustomRecipeInstance: ${error.message}`);
    }
  },

  /**
   * Actualizar una CustomRecipeInstance
   * Puede cambiar: quantity, customProductsOverrides, additionalCustomProducts
   * NO puede cambiar: dataRecipe (es inmutable)
   */
  async update(id, updateData) {
    try {
      // Remover dataRecipe si viene en el objeto (no se puede cambiar)
      delete updateData.dataRecipe;
      delete updateData._id;

      // Validar estructura después de actualizar
      const current = await customRecipeSchema.findById(id);
      const updated = { ...current.toObject(), ...updateData };
      recipeMergeService.validateCustomRecipeInstance(updated);

      const result = await customRecipeSchema.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true },
      );

      if (!result) {
        throw new Error(`CustomRecipeInstance not found: ${id}`);
      }

      return this.getById(result._id);
    } catch (error) {
      throw new Error(`Error updating CustomRecipeInstance: ${error.message}`);
    }
  },

  /**
   * Eliminar una CustomRecipeInstance
   */
  async delete(id) {
    try {
      const deleted = await customRecipeSchema.findByIdAndDelete(id);

      if (!deleted) {
        throw new Error(`CustomRecipeInstance not found: ${id}`);
      }

      return { success: true, deleted };
    } catch (error) {
      throw new Error(`Error deleting CustomRecipeInstance: ${error.message}`);
    }
  },

  /**
   * Obtener instancias de receta de una meal
   */
  async getByMealId(mealId) {
    try {
      const instances = await customRecipeSchema
        .find({ mealId: mealId })
        .populate({
          path: "dataRecipe",
          populate: {
            path: "recipe",
            populate: {
              path: "customProducts",
            },
          },
        });

      return instances;
    } catch (error) {
      throw new Error(
        `Error getting CustomRecipeInstances for meal: ${error.message}`,
      );
    }
  },

  /**
   * Obtener macros calculados de una CustomRecipeInstance
   * Usa recipeMergeService para calcular los macros finales
   */
  async getMergedData(instanceId) {
    try {
      const instance = await this.getById(instanceId);

      if (!instance) {
        throw new Error(`CustomRecipeInstance not found: ${instanceId}`);
      }

      return recipeMergeService.getMergedRecipeData(instance);
    } catch (error) {
      throw new Error(`Error getting merged recipe data: ${error.message}`);
    }
  },
};
