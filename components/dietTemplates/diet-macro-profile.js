// Sugerencias de dieta — el perfil de macros de "un día tipo" de una
// plantilla, para poder rankearla contra el objetivo del cliente.
//
// Reglas (acordadas con el usuario):
//   - Por comida: MEDIA de sus alternativas. El cliente se come una, la
//     media es el valor esperado.
//   - Por plantilla: MEDIA de los N días del ciclo (mode sequential). En
//     recurring/choice, media de los dayPatterns PONDERADA por cuántos días
//     de la semana cubre cada uno (appliesTo.length); si no hay appliesTo
//     (choice), media simple.
//
// PURO. Requiere el contenido poblado (customProducts con snapshot de macros
// o `.product` poblado — ingredientMacros ya cubre los dos casos).

const {
  ingredientMacros,
  macrosForCustomRecipe,
  sumMacroList,
} = require("../dietDays/diet-days-nutrition-util");

const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function scale(m, factor) {
  return {
    kcal: m.kcal * factor,
    protein: m.protein * factor,
    carbs: m.carbs * factor,
    fat: m.fat * factor,
  };
}

function alternativeMacros(alt) {
  return sumMacroList([
    ...(alt?.customProducts || []).map(ingredientMacros),
    ...(alt?.customRecipes || []).map(macrosForCustomRecipe),
  ]);
}

// Media de las alternativas. Una comida sin alternativas aporta 0 (hueco
// vacío en la plantilla, cuenta como "ese día no se come en ese slot").
function mealMacros(meal) {
  const alts = meal?.alternatives || [];
  if (!alts.length) return { ...ZERO };
  const total = sumMacroList(alts.map(alternativeMacros));
  return scale(total, 1 / alts.length);
}

function dayMacros(day) {
  return sumMacroList((day?.meals || []).map(mealMacros));
}

function round1(m) {
  return {
    kcal: Math.round(m.kcal),
    protein: Math.round(m.protein * 10) / 10,
    carbs: Math.round(m.carbs * 10) / 10,
    fat: Math.round(m.fat * 10) / 10,
  };
}

/**
 * El perfil de un día tipo del ciclo.
 *
 * @param {{ mode, days, dayPatterns }} doc  plantilla o copia congelada, poblada
 * @returns {{ kcal, protein, carbs, fat, basedOnDays }}  basedOnDays = cuántos
 *   días entraron en la media (para el texto "media de los 4 días del ciclo")
 */
function cycleMacroProfile(doc) {
  const mode = doc?.mode || "sequential";

  if (mode === "recurring" || mode === "choice") {
    const patterns = doc?.dayPatterns || [];
    if (!patterns.length) return { ...ZERO, basedOnDays: 0 };
    let weightedSum = { ...ZERO };
    let totalWeight = 0;
    for (const pattern of patterns) {
      const weight = mode === "recurring" ? (pattern.appliesTo || []).length || 1 : 1;
      weightedSum = sumMacroList([weightedSum, scale(dayMacros(pattern), weight)]);
      totalWeight += weight;
    }
    return { ...round1(scale(weightedSum, 1 / totalWeight)), basedOnDays: patterns.length };
  }

  const days = doc?.days || [];
  if (!days.length) return { ...ZERO, basedOnDays: 0 };
  const total = sumMacroList(days.map(dayMacros));
  return { ...round1(scale(total, 1 / days.length)), basedOnDays: days.length };
}

module.exports = { alternativeMacros, mealMacros, dayMacros, cycleMacroProfile };
