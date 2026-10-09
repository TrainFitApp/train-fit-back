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

// F20-septendecies — BUG real: un CustomProduct no siempre trae su propio
// snapshot de macros (energyKcal100g/protein100g/...) — muchos solo tienen
// el producto real POBLADO en `.product` y nada copiado al propio
// CustomProduct. La función original (la suma de kcal, antes de portarse
// aquí) ya lo sabía: `cp.energyKcal100g ?? cp.product?.energyKcal100g ?? 0`
// — ese fallback se perdió al extraer ingredientMacros() para el fix de
// recetas, así que TODO producto sin snapshot propio computaba 0 kcal en
// todos lados (adherencia, cumplimiento, seguimiento) sin ningún error
// visible. Restaurado aquí, para los 4 macros, no solo kcal.
function ingredientMacros(ingredient) {
  const quantity = ingredient?.quantity || 0;
  const multiplier = quantity / 100;
  const source = ingredient?.product || {};
  return {
    kcal: (ingredient?.energyKcal100g ?? source.energyKcal100g ?? 0) * multiplier,
    protein: (ingredient?.protein100g ?? source.protein100g ?? 0) * multiplier,
    carbs: (ingredient?.carbohydrates100g ?? source.carbohydrates100g ?? 0) * multiplier,
    fat: (ingredient?.fat100g ?? source.fat100g ?? 0) * multiplier,
  };
}

function sumMacroList(list) {
  return list.reduce(
    (acc, m) => ({
      kcal: acc.kcal + (m?.kcal || 0),
      protein: acc.protein + (m?.protein || 0),
      carbs: acc.carbs + (m?.carbs || 0),
      fat: acc.fat + (m?.fat || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function scaleMacros(macros, ratio) {
  return {
    kcal: macros.kcal * ratio,
    protein: macros.protein * ratio,
    carbs: macros.carbs * ratio,
    fat: macros.fat * ratio,
  };
}

// Campos que una entrada de modifiedBaseCustomProducts puede pisar del
// ingrediente base: catálogo único en util/nutrient-fields.js (módulo puro,
// así que esta aritmética sigue sin arrastrar mongoose).
const { RECIPE_OVERRIDE_FIELDS: CUSTOM_PRODUCT_OVERRIDE_FIELDS } = require("../util/nutrient-fields");

// Refleja recipe.service.ts#mergeRecipeIngredients del front: ingredientes
// base del Recipe, menos los eliminados, con los modificados pisando CAMPO A
// CAMPO sobre el ingrediente base.
//
// 2026-10 — antes sustituía el ingrediente base por la entrada modificada
// ENTERA, dando por hecho que cada entrada era un CustomProduct completo. No
// lo es: el front manda solo los campos que cambian
// (recipe.service.ts#buildModifiedBaseCustomProduct), así que la cuenta más
// corriente de todas —el cliente ajusta la cantidad de un ingrediente y nada
// más— dejaba un ingrediente con `quantity` y sin un solo macro, y la receta
// entera computaba 0 kcal en todo lo que cuelga de aquí: adherencia,
// cumplimiento del plan, perfil de macros de las plantillas y alertas del
// coach. El cliente veía sus kcal bien (las calcula el front) y su
// profesional veía 0.
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
    .map((ingredient) => {
      const modified = modifiedByBaseId.get(toId(ingredient));
      if (!modified) return ingredient;

      // Los documentos llegan poblados por mongoose: toObject() para no
      // escribir sobre el documento real ni arrastrar sus getters.
      const merged = ingredient?.toObject?.() || { ...ingredient };
      CUSTOM_PRODUCT_OVERRIDE_FIELDS.forEach((field) => {
        if (modified[field] !== undefined) merged[field] = modified[field];
      });
      return merged;
    });

  return [...mergedBase, ...(customRecipe.addedCustomProducts || [])];
}

// Refleja recipe.service.ts#buildNutritionCalculation: la porción
// realmente pautada no es el total de la receta, sino
// quantity / (quantityCooked || pesoCrudoTotal).
function macrosForCustomRecipe(customRecipe) {
  const ingredients = mergeRecipeIngredients(customRecipe?.recipe, customRecipe);
  const totals = sumMacroList(ingredients.map(ingredientMacros));
  const rawWeight = ingredients.reduce((acc, ing) => acc + (ing?.quantity || 0), 0);
  const baseline = toPositiveNumber(customRecipe?.quantityCooked) || rawWeight;
  const consumed = toPositiveNumber(customRecipe?.quantity);
  const portionRatio = baseline > 0 && consumed > 0 ? consumed / baseline : 0;
  return scaleMacros(totals, portionRatio);
}

// % de items pautados (customProducts + customRecipes de todas las comidas
// del día) que el cliente marcó como tomados (`consumed`).
//
// Solo cuenta lo PAUTADO (isItemPlanned): lo que el cliente añadió por su
// cuenta no es cumplimiento de nada (docs/plan-semanas.md) — antes
// entraba en el denominador y un día con extras parecía peor cumplido.
function countMealItems(meal) {
  const products = (meal?.customProducts || []).filter(isItemPlanned);
  const recipes = (meal?.customRecipes || []).filter(isItemPlanned);
  const total = products.length + recipes.length;
  const completedCount =
    products.filter((p) => p?.consumed).length + recipes.filter((r) => r?.consumed).length;
  return { total, completed: completedCount };
}

// Días sin ningún item pautado quedan fuera del cálculo.
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

// F20-ter — "pautado" es un item que el profesional prescribió
// (assignedByTrainerId set, ver Meal/CustomProduct/CustomRecipe schema).
// Todo lo demás en la comida (assignedByTrainerId null) lo añadió el
// propio cliente por su cuenta — el cliente PUEDE registrar comida no
// pautada en la misma comida (assertMealEditable solo bloquea a nivel de
// Meal completa, no impide añadir items sueltos junto a los ya pautados).
function isItemPlanned(item) {
  return !!item?.assignedByTrainerId;
}

// Un item pautado cuenta como "consumido" solo si el cliente lo marcó. Un
// item NO pautado (el cliente lo metió él mismo) cuenta como
// consumido directamente — no existe un estado "lo añadí pero todavía no
// me lo he comido" para algo que el propio cliente registró.
function isItemConsumed(item) {
  if (!isItemPlanned(item)) return true;
  return !!item?.consumed;
}

// Lo PAUTADO de un item: a la cantidad que puso el profesional
// (assignedQuantity), no a la que el cliente registró después. Sin esto, un
// cliente que se tomaba 150 g de lo pautado en 100 g subía también el
// "pautado" del día y la desviación salía cero.
function plannedView(item) {
  const assigned = item?.assignedQuantity;
  if (assigned === null || assigned === undefined) return item;
  const base = typeof item?.toObject === "function" ? item.toObject() : item;
  return { ...base, quantity: assigned };
}

function mealTracking(meal) {
  const products = meal?.customProducts || [];
  const recipes = meal?.customRecipes || [];

  const plannedMacros = sumMacroList([
    ...products.filter(isItemPlanned).map((p) => ingredientMacros(plannedView(p))),
    ...recipes.filter(isItemPlanned).map((r) => macrosForCustomRecipe(plannedView(r))),
  ]);
  const consumedMacros = sumMacroList([
    ...products.filter((p) => isItemConsumed(p)).map(ingredientMacros),
    ...recipes.filter((r) => isItemConsumed(r)).map(macrosForCustomRecipe),
  ]);

  return {
    hasPlan: products.some(isItemPlanned) || recipes.some(isItemPlanned),
    planned: plannedMacros,
    consumed: consumedMacros,
  };
}

// Día completo: suma de "pautado" y "consumido" (según mealTracking) sobre
// todas las comidas. hasPlan = hubo AL MENOS un item pautado ese día
// (independiente de si su kcal es 0) — para distinguir "sin plan ese día"
// de "plan con 0 kcal".
function computeDayTracking(meals) {
  return (meals || []).reduce(
    (acc, meal) => {
      const { hasPlan, planned, consumed } = mealTracking(meal);
      return {
        hasPlan: acc.hasPlan || hasPlan,
        planned: sumMacroList([acc.planned, planned]),
        consumed: sumMacroList([acc.consumed, consumed]),
      };
    },
    {
      hasPlan: false,
      planned: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      consumed: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    },
  );
}

// Fase 1 Coach Pro — adherencia nutricional de un RANGO, no de un día.
// Vive aquí (junto a computeDayCompletion, del que se alimenta) y no en un
// módulo nuevo porque es exactamente la misma aritmética una capa más
// arriba.
//
// Dos números, nunca uno solo:
//   - `percentage`: media de cumplimiento sobre los días QUE TIENEN PLAN.
//     Responde "cuando tiene algo que hacer, ¿lo hace?".
//   - `coverage`: qué parte del rango tenía plan.
//     Responde "¿de cuántos días estamos hablando?".
// Un único porcentaje que mezcle ambos oculta el problema real —
// exactamente lo que hay que evitar según la especificación de adherencia:
// un cliente perfecto con plan de 10 días dentro de un rango de 30 no es un
// cliente al 33%.
function computeRangeAdherence(days, periodDays) {
  const perDay = (days || [])
    .map((day) => computeDayCompletion(day.meals))
    .filter((result) => result.hasPlan);

  const daysWithData = perDay.length;
  const totalDays = periodDays || daysWithData;

  return {
    percentage: daysWithData
      ? Math.round(perDay.reduce((acc, d) => acc + d.completionPercentage, 0) / daysWithData)
      : null,
    daysWithData,
    periodDays: totalDays,
    coveragePercentage: totalDays ? Math.round((daysWithData / totalDays) * 100) : 0,
  };
}

// Margen único de la adherencia calórica: un día cuadra si lo comido queda a
// ±15 % de lo pautado (adherencia de la ficha y desviación del resumen del
// día).
const KCAL_TOLERANCE = 0.15;

module.exports = {
  KCAL_TOLERANCE,
  CUSTOM_PRODUCT_OVERRIDE_FIELDS,
  plannedView,
  mergeRecipeIngredients,
  ingredientMacros,
  macrosForCustomRecipe,
  sumMacroList,
  countMealItems,
  computeDayCompletion,
  computeDayTracking,
  computeRangeAdherence,
  // Las dos reglas de "qué cuenta como pautado" y "qué cuenta como
  // consumido". Se exportan para que food-compliance.js las reutilice en vez
  // de reimplementarlas: si el criterio cambia, tiene que cambiar en un sitio.
  isItemPlanned,
  isItemConsumed,
};
