// Sugerencias de dieta — el ranking. Dado el objetivo de kcal+macros de un
// cliente y un conjunto de plantillas candidatas, las ordena por cercanía.
//
// - Filtro DURO por restricciones dietéticas (vegano, sin gluten...): las que
//   no pasan salen aparte, en `hidden`, no se rankean.
// - Orden por distancia ponderada normalizada. Pesos provisionales,
//   ajustables con uso real: kcal manda, luego proteína.
//
// PURO.

const { passesDietaryFilter } = require("./diet-suitability");

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
 * @returns {{ ranked: Array, hidden: Array }}
 *   ranked: ordenadas, con { ...candidate, distance, deltas, rank }
 *   hidden: las que no pasan el filtro dietético, con { _id, name, missingFlags }
 */
function rankTemplates(candidates, target, requiredFlags = []) {
  const ranked = [];
  const hidden = [];

  for (const c of candidates || []) {
    if (!passesDietaryFilter(c, requiredFlags)) {
      const effective = new Set([...(c.suitableFor || []), ...(c.suitableForOverride || [])]);
      hidden.push({
        _id: c._id,
        name: c.name,
        missingFlags: requiredFlags.filter((f) => !effective.has(f)),
      });
      continue;
    }
    ranked.push({
      ...c,
      distance: Math.round(distance(c.profile || {}, target) * 1000) / 1000,
      deltas: deltas(c.profile || {}, target),
    });
  }

  ranked.sort((a, b) => a.distance - b.distance);
  ranked.forEach((item, i) => {
    item.rank = i + 1;
  });

  return { ranked, hidden };
}

module.exports = { WEIGHTS, distance, deltas, rankTemplates };
