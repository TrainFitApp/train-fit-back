// Sugerencias de dieta — de qué restricciones dietéticas es apta una
// plantilla, DERIVADO de sus alimentos.
//
// Regla: la plantilla lleva "vegan" solo si TODOS sus productos tienen
// `vegan === true` (igual para vegetarian / lactoseFree / glutenFree). Un
// flag `null` en un producto = "desconocido" y NO certifica — mejor no decir
// "vegana" y equivocarse. El entrenador puede forzar la aptitud a mano
// (suitableForOverride) cuando sabe que es apta pese a productos sin marcar.
//
// PURO. Entra el contenido de la plantilla (days/dayPatterns con
// customProducts poblados), salen strings.

const FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

// Recorre TODO el contenido de una plantilla y junta cada CustomProduct que
// aparece: en las alternativas directas y dentro de las recetas (diffs +
// receta base si viene poblada).
function collectProducts(doc) {
  const out = [];
  const containers = [...(doc?.days || []), ...(doc?.dayPatterns || [])];
  for (const container of containers) {
    for (const meal of container.meals || []) {
      for (const alt of meal.alternatives || []) {
        for (const cp of alt.customProducts || []) out.push(cp);
        for (const cr of alt.customRecipes || []) {
          for (const cp of cr.addedCustomProducts || []) out.push(cp);
          for (const cp of cr.modifiedBaseCustomProducts || []) out.push(cp);
          for (const cp of cr.recipe?.customProducts || []) out.push(cp);
        }
      }
    }
  }
  return out;
}

/**
 * @returns {{ suitableFor: string[], missingFlagCounts: Record<string, number>, productCount: number }}
 *   `missingFlagCounts` = cuántos productos no declaran cada flag (para el
 *   aviso del builder: "3 productos sin marcar si son veganos").
 */
function deriveSuitability(doc) {
  const products = collectProducts(doc);
  const suitableFor = [];
  const missingFlagCounts = {};

  for (const flag of FLAGS) {
    let allTrue = products.length > 0;
    let missing = 0;
    for (const p of products) {
      if (p?.[flag] === true) continue;
      allTrue = false;
      if (p?.[flag] === undefined || p?.[flag] === null) missing += 1;
    }
    if (allTrue) suitableFor.push(flag);
    missingFlagCounts[flag] = missing;
  }

  return { suitableFor, missingFlagCounts, productCount: products.length };
}

/** La aptitud que ve el filtro = lo derivado ∪ lo que el entrenador forzó. */
function effectiveSuitability(suitableFor = [], suitableForOverride = []) {
  return [...new Set([...suitableFor, ...suitableForOverride])].filter((f) => FLAGS.includes(f));
}

/**
 * ¿Esta plantilla pasa el filtro duro del cajón? Pasa si cumple TODAS las
 * restricciones que el cliente tiene marcadas.
 */
function passesDietaryFilter({ suitableFor, suitableForOverride }, requiredFlags = []) {
  if (!requiredFlags.length) return true;
  const effective = new Set(effectiveSuitability(suitableFor, suitableForOverride));
  return requiredFlags.every((flag) => effective.has(flag));
}

module.exports = {
  FLAGS,
  collectProducts,
  deriveSuitability,
  effectiveSuitability,
  passesDietaryFilter,
};
