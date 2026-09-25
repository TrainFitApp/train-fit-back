// Sugerencias de dieta — de qué restricciones dietéticas es apta una
// plantilla, DERIVADO de sus alimentos.
//
// Regla: la plantilla lleva "vegan" solo si TODOS sus productos tienen
// `vegan === true` (igual para vegetarian / lactoseFree / glutenFree). Un
// flag `null` en un producto = "desconocido" y NO certifica — mejor no decir
// "vegana" y equivocarse. El entrenador puede forzar la aptitud a mano
// (suitableForOverride) cuando sabe que es apta pese a productos sin marcar.
//
// PURO. Entra el contenido de la plantilla (menús con customProducts
// poblados), salen strings.

const FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

// Recorre TODO el contenido de una plantilla y junta cada CustomProduct que
// aparece: en las alternativas directas y dentro de las recetas (diffs +
// receta base si viene poblada).
function collectProducts(doc) {
  const out = [];
  const containers = doc?.menus || [];
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

// El flag vive en el CustomProduct si se copió con datos completos (búsqueda
// de alimentos del cliente), o solo en el Product del catálogo (plantillas
// de biblioteca, que guardan {product, quantity}). El Product llega poblado
// por autopopulate en cascada.
function readFlag(p, flag) {
  if (p?.[flag] === true || p?.[flag] === false) return p[flag];
  const prod = p?.product;
  if (prod && typeof prod === "object" && (prod[flag] === true || prod[flag] === false)) {
    return prod[flag];
  }
  return null;
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
      const value = readFlag(p, flag);
      if (value === true) continue;
      allTrue = false;
      if (value === null) missing += 1;
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
 * Qué restricciones del cliente NO cumple esta plantilla. Array vacío = las
 * cumple todas.
 *
 * 2026-09 — antes esto era un booleano (`passesDietaryFilter`) y las que
 * daban `false` se escondían del ranking. Ahora salen igual, ordenadas por
 * macros detrás de las que sí cumplen, y esta lista es lo que el cartel rojo
 * de la tarjeta enseña: una dieta que cuadra de macros pero lleva un
 * alimento con gluten se arregla cambiando ese alimento, y esconderla
 * obligaba a descartarla entera.
 *
 * Ojo con lo que significa: un flag "falta" tanto si algún alimento NO lo
 * cumple como si simplemente no lo declara (`null` = desconocido, ver
 * deriveSuitability). Por eso el cartel nombra la restricción incumplida y
 * no acusa al contenido ("No cumple: Sin gluten", no "lleva gluten").
 */
function missingDietaryFlags({ suitableFor, suitableForOverride }, requiredFlags = []) {
  if (!requiredFlags.length) return [];
  const effective = new Set(effectiveSuitability(suitableFor, suitableForOverride));
  return requiredFlags.filter((flag) => FLAGS.includes(flag) && !effective.has(flag));
}

module.exports = {
  FLAGS,
  collectProducts,
  deriveSuitability,
  effectiveSuitability,
  missingDietaryFlags,
};
