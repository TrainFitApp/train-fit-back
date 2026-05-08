const mongoose = require("mongoose");
const recipeSchema = require("./recipe-schema");

class RecipeMergeService {
  constructor() {
    this.CUSTOM_PRODUCT_OVERRIDE_FIELDS = [
      "quantity",
      "energyKcal100g",
      "protein100g",
      "carbohydrates100g",
      "fat100g",
      "saturatedFat100g",
      "sugars100g",
      "fiber100g",
      "salt100g",
      "sodium100g",
      "cholesterol100g",
      "transFat100g",
      "calcium100g",
      "iron100g",
      "magnesium100g",
      "phosphorus100g",
      "potassium100g",
      "zinc100g",
      "copper100g",
      "manganese100g",
      "selenium100g",
      "iodine100g",
      "vitaminA100g",
      "vitaminC100g",
      "vitaminD100g",
      "vitaminE100g",
      "vitaminK100g",
      "vitaminB1100g",
      "vitaminB2100g",
      "vitaminB3100g",
      "vitaminB5100g",
      "vitaminB6100g",
      "vitaminB9100g",
      "vitaminB12100g",
      "biotin100g",
      "omega3100g",
      "omega6100g",
      "omega9100g",
      "caffeine100g",
      "taurine100g",
      "alcohol100g",
      "ingredients",
      "allergens",
      "traces",
      "vegan",
      "vegetarian",
      "lactoseFree",
      "glutenFree",
    ];
  }

  hasOwn(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  normalizePositiveNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  validateCustomRecipe(customRecipe) {
    if (!customRecipe.recipe) {
      throw new Error("customRecipe.recipe is required");
    }

    const quantity = this.normalizePositiveNumber(customRecipe.quantity);
    if (customRecipe.quantity !== undefined && customRecipe.quantity !== null && !quantity) {
      throw new Error("customRecipe.quantity must be a positive number");
    }

    const quantityCooked = this.normalizePositiveNumber(customRecipe.quantityCooked);
    if (
      customRecipe.quantityCooked !== undefined &&
      customRecipe.quantityCooked !== null &&
      !quantityCooked
    ) {
      throw new Error("customRecipe.quantityCooked must be a positive number");
    }

    if (
      customRecipe.modifiedBaseCustomProducts &&
      !Array.isArray(customRecipe.modifiedBaseCustomProducts)
    ) {
      throw new Error("modifiedBaseCustomProducts must be an array");
    }

    if (
      customRecipe.removedBaseCustomProductIds &&
      !Array.isArray(customRecipe.removedBaseCustomProductIds)
    ) {
      throw new Error("removedBaseCustomProductIds must be an array");
    }

    if (customRecipe.addedCustomProducts && !Array.isArray(customRecipe.addedCustomProducts)) {
      throw new Error("addedCustomProducts must be an array");
    }
  }

  normalizeArrayValue(value) {
    return Array.isArray(value) ? [...value] : value;
  }

  normalizeObjectId(value) {
    if (!value) return null;

    const rawValue = value?._id || value;
    const normalizedValue =
      typeof rawValue === "string" ? rawValue : rawValue?.toString?.();

    if (!normalizedValue || !mongoose.Types.ObjectId.isValid(normalizedValue)) {
      return null;
    }

    return normalizedValue;
  }

  sanitizeCustomProductData(customProduct, options = {}) {
    const {
      includeBaseCustomProductId = false,
      includeProduct = true,
      includeId = false,
    } = options;
    const nextValue = {};

    if (includeId && customProduct?._id) {
      const normalizedId = this.normalizeObjectId(customProduct._id);
      if (normalizedId) {
        nextValue._id = normalizedId;
      }
    }

    if (includeBaseCustomProductId && customProduct?.baseCustomProductId) {
      const normalizedBaseCustomProductId = this.normalizeObjectId(
        customProduct.baseCustomProductId,
      );
      if (normalizedBaseCustomProductId) {
        nextValue.baseCustomProductId = normalizedBaseCustomProductId;
      }
    }

    if (includeProduct) {
      const productId = this.normalizeObjectId(customProduct?.product);
      if (productId) {
        nextValue.product = productId;
      }
    }

    this.CUSTOM_PRODUCT_OVERRIDE_FIELDS.forEach((field) => {
      if (!this.hasOwn(customProduct, field)) {
        return;
      }

      const rawValue = customProduct?.[field];
      const value =
        field === "quantity"
          ? this.normalizePositiveNumber(rawValue)
          : this.normalizeArrayValue(rawValue);

      if (value === undefined) {
        return;
      }

      if (typeof value === "string" && value.trim() === "") {
        return;
      }

      nextValue[field] = value;
    });

    return nextValue;
  }

  async resolveRecipe(customRecipe) {
    const recipeRef =
      customRecipe.recipe?._id || customRecipe.recipeId || customRecipe.recipe;
    const recipe = await recipeSchema.findById(recipeRef);
    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeRef}`);
    }
    return recipe;
  }

  buildMergedIngredients(recipe, customRecipe) {
    const baseIngredients = recipe.customProducts || [];
    const modifiedMap = new Map();
    const removedSet = new Set(
      (customRecipe.removedBaseCustomProductIds || []).map((id) =>
        (id?._id || id).toString(),
      ),
    );

    (customRecipe.modifiedBaseCustomProducts || []).forEach((item) => {
      const id = item.baseCustomProductId?._id || item.baseCustomProductId;
      if (!id) return;
      modifiedMap.set(id.toString(), item);
    });

    const activeBaseIngredients = baseIngredients
      .filter((ingredient) => !removedSet.has(ingredient._id.toString()))
      .map((ingredient) => {
        const modified = modifiedMap.get(ingredient._id.toString());
        if (!modified) return ingredient;
        const ingredientObj = ingredient.toObject?.() || { ...ingredient };
        const mergedIngredient = { ...ingredientObj };

        this.CUSTOM_PRODUCT_OVERRIDE_FIELDS.forEach((field) => {
          if (modified[field] !== undefined) {
            mergedIngredient[field] = this.normalizeArrayValue(modified[field]);
          }
        });

        return mergedIngredient;
      });

    const addedIngredients = (customRecipe.addedCustomProducts || []).map(
      (item) => item.toObject?.() || { ...item },
    );

    const removedIngredients = baseIngredients.filter((ingredient) =>
      removedSet.has(ingredient._id.toString()),
    );

    return {
      ingredients: [...activeBaseIngredients, ...addedIngredients],
      removedIngredients,
    };
  }

  calculateMacros(customProducts) {
    return customProducts.reduce(
      (acc, cp) => {
        const quantity = this.normalizePositiveNumber(cp.quantity) || 0;
        const ratio = quantity / 100;
        const product = cp.product || {};

        acc.kcal += (cp.energyKcal100g ?? product.energyKcal100g ?? 0) * ratio;
        acc.protein += (cp.protein100g ?? product.protein100g ?? 0) * ratio;
        acc.carbs +=
          (cp.carbohydrates100g ?? product.carbohydrates100g ?? 0) * ratio;
        acc.fat += (cp.fat100g ?? product.fat100g ?? 0) * ratio;
        acc.quantity += quantity;
        return acc;
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0, quantity: 0 },
    );
  }

  async getMergedRecipeData(customRecipe) {
    const recipe = await this.resolveRecipe(customRecipe);
    const { ingredients, removedIngredients } = this.buildMergedIngredients(
      recipe,
      customRecipe,
    );
    const totals = this.calculateMacros(ingredients);
    const baseline =
      this.normalizePositiveNumber(customRecipe.quantityCooked) || totals.quantity || 0;
    const consumed = this.normalizePositiveNumber(customRecipe.quantity) || 0;
    const ratio = baseline > 0 ? consumed / baseline : 0;

    return {
      recipe,
      ingredients,
      removedIngredients,
      totalMacros: totals,
      portionMacros: {
        kcal: totals.kcal * ratio,
        protein: totals.protein * ratio,
        carbs: totals.carbs * ratio,
        fat: totals.fat * ratio,
      },
    };
  }
}

module.exports = new RecipeMergeService();
