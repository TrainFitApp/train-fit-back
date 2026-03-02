/**
 * RecipeMergeService - Servicio para calcular macros finales de una CustomRecipeInstance
 * CRÍTICO: Este servicio es esencial para que los cálculos de macros sean correctos
 */

const recipeDao = require("./recipe-dao");
const dataRecipeDao = require("../dataRecipes/data-recipe-dao");
const customProductDao = require("../customProducts/custom-product-dao");

class RecipeMergeService {
  /**
   * Obtiene los CustomProducts finales de una CustomRecipeInstance
   * Aplica overrides y calcula cantidades ajustadas por porción
   *
   * @param {Object} customRecipeInstance - La instancia de receta en la meal
   * @returns {Promise<Object>} { finalCustomProducts, totalMacros }
   */
  async getMergedRecipeData(customRecipeInstance) {
    try {
      // 1. Obtener DataRecipe completa
      const dataRecipe = await dataRecipeDao.getById(
        customRecipeInstance.dataRecipe._id || customRecipeInstance.dataRecipe,
      );

      if (!dataRecipe) {
        throw new Error(
          `DataRecipe not found: ${customRecipeInstance.dataRecipe}`,
        );
      }

      // 2. Obtener Recipe completa con CustomProducts poblados
      const recipe = await recipeDao.getRecipeById(
        dataRecipe.recipe._id || dataRecipe.recipe,
      );

      if (!recipe || !recipe.customProducts) {
        throw new Error(`Recipe not found or has no customProducts`);
      }

      // 3. Construir mapa de overrides para acceso rápido
      const overridesMap = new Map();
      if (customRecipeInstance.customProductsOverrides) {
        customRecipeInstance.customProductsOverrides.forEach((override) => {
          overridesMap.set(override.customProductId.toString(), override);
        });
      }

      // 4. Aplicar overrides a los CustomProducts originales
      const finalCustomProducts = [];

      for (const cp of recipe.customProducts) {
        const cpId = cp._id.toString();
        const override = overridesMap.get(cpId);

        // Si está marcado como removed, saltar
        if (override?.removed) {
          continue;
        }

        // Usar cantidad del override o la original
        const originalQuantity = override?.quantity ?? cp.quantity;

        // Escalar por la cantidad de receta añadida a la meal
        // Ejemplo: si la receta original es 100g total y se añaden 300g,
        // cada ingrediente se multiplica por 3
        const scaledQuantity =
          (originalQuantity * customRecipeInstance.quantity) / 100;

        finalCustomProducts.push({
          ...(cp.toObject ? cp.toObject() : cp),
          quantity: scaledQuantity,
          _customProductId: cpId, // Tag para tracking
        });
      }

      // 5. Añadir ingredientes adicionales
      if (customRecipeInstance.additionalCustomProducts?.length) {
        customRecipeInstance.additionalCustomProducts.forEach((addCP) => {
          const scaledQuantity =
            (addCP.quantity * customRecipeInstance.quantity) / 100;

          finalCustomProducts.push({
            ...addCP,
            quantity: scaledQuantity,
            _isAdditional: true, // Tag para tracking
          });
        });
      }

      // 6. Calcular macros totales
      const totalMacros = this.calculateMacros(finalCustomProducts);

      return {
        finalCustomProducts,
        totalMacros,
      };
    } catch (err) {
      throw new Error(`Error merging recipe data: ${err.message}`);
    }
  }

  /**
   * Calcula los macros totales de un array de CustomProducts
   * @private
   */
  calculateMacros(customProducts) {
    return customProducts.reduce(
      (acc, cp) => ({
        kcal:
          acc.kcal + this.calculateMacroValue(cp.energyKcal100g, cp.quantity),
        protein:
          acc.protein + this.calculateMacroValue(cp.protein100g, cp.quantity),
        carbs:
          acc.carbs +
          this.calculateMacroValue(cp.carbohydrates100g, cp.quantity),
        fat: acc.fat + this.calculateMacroValue(cp.fat100g, cp.quantity),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }

  /**
   * Calcula un macro específico (valor_por_100g * cantidad_en_gramos / 100)
   * @private
   */
  calculateMacroValue(valuePer100g, quantityGrams) {
    if (!valuePer100g || !quantityGrams) return 0;
    return (valuePer100g * quantityGrams) / 100;
  }

  /**
   * Valida que la estructura de una CustomRecipeInstance sea correcta
   * @throws {Error} si hay errores de estructura
   */
  validateCustomRecipeInstance(customRecipeInstance) {
    console.log("🔍 Validating CustomRecipeInstance:", customRecipeInstance);

    // Aceptar tanto dataRecipe como dataRecipeId
    if (
      !customRecipeInstance.dataRecipe &&
      !customRecipeInstance.dataRecipeId
    ) {
      console.error("❌ Validation failed: no dataRecipe or dataRecipeId");
      throw new Error("customRecipeInstance.dataRecipe is required");
    }

    console.log(
      "✅ dataRecipe/dataRecipeId exists:",
      customRecipeInstance.dataRecipe || customRecipeInstance.dataRecipeId,
    );

    if (
      typeof customRecipeInstance.quantity !== "number" ||
      customRecipeInstance.quantity <= 0
    ) {
      console.error(
        "❌ Validation failed: invalid quantity",
        customRecipeInstance.quantity,
      );
      throw new Error(
        "customRecipeInstance.quantity must be a positive number",
      );
    }

    console.log("✅ Quantity valid:", customRecipeInstance.quantity);

    if (customRecipeInstance.customProductsOverrides) {
      if (!Array.isArray(customRecipeInstance.customProductsOverrides)) {
        throw new Error("customProductsOverrides must be an array");
      }

      customRecipeInstance.customProductsOverrides.forEach((override) => {
        if (!override.customProductId) {
          throw new Error("Each override must have customProductId");
        }
      });
    }

    if (customRecipeInstance.additionalCustomProducts) {
      if (!Array.isArray(customRecipeInstance.additionalCustomProducts)) {
        throw new Error("additionalCustomProducts must be an array");
      }
    }
  }
}

module.exports = new RecipeMergeService();
