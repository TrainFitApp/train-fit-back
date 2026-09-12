// Sugerencias de dieta — el ranking. Dado el objetivo de kcal+macros de un
// cliente y un conjunto de plantillas candidatas, las ordena por cercanía.
//
// - Orden por distancia ponderada normalizada. Pesos provisionales,
//   ajustables con uso real: kcal manda, luego proteína.
// - Restricciones dietéticas (vegano, sin gluten...): NO descartan. Las que
//   no cumplen salen igual, con `missingFlags`, pero SIEMPRE detrás de las
//   que sí cumplen. Ver missingDietaryFlags en diet-suitability.js para el
//   porqué del cambio.
//
// El bloque de las que cumplen va primero a propósito y no mezclado por
// distancia pura: el primero de la lista es el que el panel aplica por
// defecto (ver `chosen` en diet-suggestion-drawer), así que mezclarlas
// dejaría a un celíaco con una dieta con gluten a un solo click, sin
// haberla elegido nadie.
//
// PURO.

const { missingDietaryFlags } = require("./diet-suitability");

const WEIGHTS = { kcal: 0.5, protein: 0.3, carbs: 0.1, fat: 0.1 };

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

/**
 * Distancia entre el perfil de una plantilla y el objetivo del cliente.
 * Cada término normalizado por el valor objetivo para que sumen bien
 * (kcal ~2500, proteína ~150 no son comparables en crudo).
 */
function distance(profile, target) {
  const d = {
    kcal: safeDiv(Math.abs((profile.kcal || 0) - target.kcal), target.kcal),
    protein: safeDiv(Math.abs((profile.protein || 0) - target.protein), target.protein),
    carbs: safeDiv(Math.abs((profile.carbs || 0) - target.carbs), target.carbs),
    fat: safeDiv(Math.abs((profile.fat || 0) - target.fat), target.fat),
  };
  return (
    WEIGHTS.kcal * d.kcal +
    WEIGHTS.protein * d.protein +
    WEIGHTS.carbs * d.carbs +
    WEIGHTS.fat * d.fat
  );
}

function deltas(profile, target) {
  return {
    kcal: Math.round((profile.kcal || 0) - target.kcal),
    protein: Math.round(((profile.protein || 0) - target.protein) * 10) / 10,
    carbs: Math.round(((profile.carbs || 0) - target.carbs) * 10) / 10,
    fat: Math.round(((profile.fat || 0) - target.fat) * 10) / 10,
  };
}

/**
 * @param {Array} candidates  cada uno: { _id, name, profile:{kcal,protein,carbs,fat},
 *   suitableFor, suitableForOverride, verified, ownerClientId }
 * @param {{kcal,protein,carbs,fat}} target
 * @param {string[]} requiredFlags  restricciones del cliente (dietaryFlags)
 * @returns {{ ranked: Array }}
 *   ranked: TODAS, con { ...candidate, distance, deltas, missingFlags, rank }.
 *   Primero las que cumplen las restricciones (por distancia), después las
 *   que no (también por distancia).
 */
function rankTemplates(candidates, target, requiredFlags = []) {
  const ranked = (candidates || []).map((c) => ({
    ...c,
    missingFlags: missingDietaryFlags(c, requiredFlags),
    distance: Math.round(distance(c.profile || {}, target) * 1000) / 1000,
    deltas: deltas(c.profile || {}, target),
  }));

  ranked.sort((a, b) => {
    const cumpleA = a.missingFlags.length === 0;
    const cumpleB = b.missingFlags.length === 0;
    if (cumpleA !== cumpleB) return cumpleA ? -1 : 1;
    return a.distance - b.distance;
  });
  ranked.forEach((item, i) => {
    item.rank = i + 1;
  });

  return { ranked };
}

module.exports = { WEIGHTS, distance, deltas, rankTemplates };
