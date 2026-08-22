// MVP-trainers F20-bis — puerto a backend (solo kcal + cumplimiento, sin
// macros/portion-metadata) de la lógica de merge de ingredientes de una
// CustomRecipe que hasta ahora solo existía en el frontend
// (packages/shared-core/src/app/core/services/recipe/recipe.service.ts).
// Necesario para que la adherencia (F20) y el % de cumplimiento del plan
// cuenten también las recetas, no solo los customProducts sueltos de cada
// comida (limitación conocida documentada en
// trainer-client-data-controller.js hasta ahora).
//
// Requiere que los documentos vengan completamente poblados por el
// mecanismo estándar de Mongoose (autopopulate en cascada, no aggregate) —
// ver diet-days-dao.js#getFullyPopulatedDietDaysForDiet.

function toId(value) {
  const raw = value?._id || value;
  return raw?.toString?.() || null;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function ingredientKcal(ingredient) {
  const kcalPer100g = ingredient?.energyKcal100g || 0;
  const quantity = ingredient?.quantity || 0;
  return (kcalPer100g * quantity) / 100;
}

// Refleja recipe.service.ts#mergeRecipeIngredients: ingredientes base del
// Recipe, menos los eliminados, con los modificados sustituidos por su
// versión completa ya guardada. modifiedBaseCustomProducts NO es un diff
// parcial en el backend — cada entrada es un CustomProduct nuevo y
// completo con su propio baseCustomProductId apuntando al ingrediente que
// reemplaza (ver custom-product-schema.js), así que un reemplazo íntegro
// (no un overlay campo a campo) da el mismo resultado.
function mergeRecipeIngredients(recipe, customRecipe) {
  const baseIngredients = recipe?.customProducts || [];
  if (!customRecipe) return baseIngredients;

  const removedIds = new Set(
    (customRecipe.removedBaseCustomProductIds || []).map(toId).filter(Boolean),
  );
  const modifiedByBaseId = new Map();
  (customRecipe.modifiedBaseCustomProducts || []).forEach((item) => {
    const baseId = toId(item?.baseCustomProductId);
    if (baseId) modifiedByBaseId.set(baseId, item);
  });

  const mergedBase = baseIngredients
    .filter((ingredient) => !removedIds.has(toId(ingredient)))
    .map((ingredient) => modifiedByBaseId.get(toId(ingredient)) || ingredient);

  return [...mergedBase, ...(customRecipe.addedCustomProducts || [])];
}

// Refleja recipe.service.ts#buildNutritionCalculation: la porción
// realmente pautada no es el total de la receta, sino
// quantity / (quantityCooked || pesoCrudoTotal).
function kcalForCustomRecipe(customRecipe) {
  const ingredients = mergeRecipeIngredients(customRecipe?.recipe, customRecipe);
  const totalKcal = ingredients.reduce((acc, ing) => acc + ingredientKcal(ing), 0);
  const rawWeight = ingredients.reduce((acc, ing) => acc + (ing?.quantity || 0), 0);
  const baseline = toPositiveNumber(customRecipe?.quantityCooked) || rawWeight;
  const consumed = toPositiveNumber(customRecipe?.quantity);
  const portionRatio = baseline > 0 && consumed > 0 ? consumed / baseline : 0;
  return totalKcal * portionRatio;
}

function kcalForMeal(meal) {
  const productsKcal = (meal?.customProducts || []).reduce(
    (acc, cp) => acc + ingredientKcal(cp),
    0,
  );
  const recipesKcal = (meal?.customRecipes || []).reduce(
    (acc, cr) => acc + kcalForCustomRecipe(cr),
    0,
  );
  return productsKcal + recipesKcal;
}

function sumMealsKcal(meals) {
  return (meals || []).reduce((acc, meal) => acc + kcalForMeal(meal), 0);
}

// % de items pautados (customProducts + customRecipes de todas las comidas
// del día) que el cliente marcó como hechos. Meal.completed cuenta todos
// sus items como hechos aunque algún flag individual no se haya tocado —
// una confirmación explícita de "toda la comida" no debe quedar
// contradicha por un detalle sin marcar.
function countMealItems(meal) {
  const products = meal?.customProducts || [];
  const recipes = meal?.customRecipes || [];
  const total = products.length + recipes.length;
  if (meal?.completed) return { total, completed: total };
  const completedCount =
    products.filter((p) => p?.consumed).length + recipes.filter((r) => r?.consumed).length;
  return { total, completed: completedCount };
}

// Días sin ningún item pautado quedan fuera del cálculo (mismo criterio
// que ya usa getClientAdherence para su dailyBreakdown).
function computeDayCompletion(meals) {
  const totals = (meals || []).reduce(
    (acc, meal) => {
      const { total, completed } = countMealItems(meal);
      acc.total += total;
      acc.completed += completed;
      return acc;
    },
    { total: 0, completed: 0 },
  );

  return {
    hasPlan: totals.total > 0,
    completionPercentage:
      totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : null,
  };
}

module.exports = {
  mergeRecipeIngredients,
  kcalForCustomRecipe,
  kcalForMeal,
  sumMealsKcal,
  countMealItems,
  computeDayCompletion,
};
