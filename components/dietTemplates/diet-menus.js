const mongoose = require("mongoose");
const { buildCustomRecipe } = require("../customRecipes/custom-recipe-builder");
const { MEALS } = require("../dietDays/diet-days-util");

// Menús de un plan de dieta (diet-menu-schema.js): lo que llega del
// constructor de la app de entrenadores y cómo se guarda. Lo comparten las
// plantillas de biblioteca (DietTemplate) y las fases asignadas (DietPhase):
// una fase nace copiando los menús de una plantilla, o con menús nuevos.

const VALID_SLOTS = new Set(Object.values(MEALS));
const MAX_ALTERNATIVES = 4;

// --- Saneado de la entrada (PURO) ---

// 0 alternativas = comida vacía, 1 = sin elección, 2+ = el cliente elige
// (ver diet-day-resolver.js#applyResolvedPlanToDietDay). Los alimentos y
// recetas pasan tal cual: los valida materializeMenus al construirlos.
function sanitizeAlternatives(alternatives) {
  return (Array.isArray(alternatives) ? alternatives : [])
    .slice(0, MAX_ALTERNATIVES)
    .map((alt) => ({
      label: (alt?.label || "").toString().trim().slice(0, 100),
      customProducts: Array.isArray(alt?.customProducts) ? alt.customProducts : [],
      customRecipes: Array.isArray(alt?.customRecipes) ? alt.customRecipes : [],
    }));
}

function sanitizeMeals(meals) {
  return (Array.isArray(meals) ? meals : [])
    .filter((meal) => VALID_SLOTS.has(meal?.slot))
    .map((meal) => ({
      slot: meal.slot,
      alternatives: sanitizeAlternatives(meal?.alternatives),
    }));
}

// El nombre de un menú es la CLAVE con la que el cliente lo elige (se guarda
// en DietDay.menuName), así que dos menús del mismo plan no pueden llamarse
// igual: al repetido se le añade un sufijo en vez de rechazar el guardado
// entero por un detalle que el editor puede arreglar solo.
function sanitizeMenus(menus) {
  if (!Array.isArray(menus)) return [];
  const used = new Set();
  return menus.map((menu, index) => {
    const base = (menu?.name || "").toString().trim().slice(0, 50) || `Menú ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base.slice(0, 46)} (${suffix++})`;
    used.add(name);
    return { name, meals: sanitizeMeals(menu?.meals) };
  });
}

// --- Construcción de lo que se guarda ---

// Un alimento o receta puede llegar con sus referencias pobladas (copiando un
// plan ya guardado) o como id (del constructor): se guardan siempre como id.
const refId = (value) => (value && typeof value === "object" && value._id ? value._id : value);

function plainProduct(cp) {
  const { _id, __v, ...rest } = cp && typeof cp === "object" ? cp : {};
  if (rest.product) rest.product = refId(rest.product);
  if (rest.baseCustomProductId) rest.baseCustomProductId = refId(rest.baseCustomProductId);
  return rest;
}

function plainRecipe(cr) {
  const { _id, __v, recipe, addedCustomProducts, modifiedBaseCustomProducts, ...rest } = cr;
  return {
    ...rest,
    recipe: refId(recipe),
    addedCustomProducts: (addedCustomProducts || []).map(plainProduct),
    modifiedBaseCustomProducts: (modifiedBaseCustomProducts || []).map(plainProduct),
  };
}

// Alimentos y recetas de una alternativa con ids NUEVOS: un plan nunca
// comparte ids con otro (la copia de una plantilla es independiente de ella).
async function materializeAlternative(alt) {
  const customProducts = (alt?.customProducts || []).map((cp) => ({
    ...plainProduct(cp),
    _id: new mongoose.Types.ObjectId(),
  }));
  const customRecipes = [];
  for (const cr of alt?.customRecipes || []) {
    if (!cr?.recipe) continue;
    customRecipes.push(await buildCustomRecipe(plainRecipe(cr)));
  }
  return { label: alt?.label || "", customProducts, customRecipes };
}

async function materializeMenus(menus) {
  const result = [];
  for (const menu of menus || []) {
    const meals = [];
    for (const meal of menu.meals || []) {
      const alternatives = [];
      for (const alt of meal.alternatives || []) alternatives.push(await materializeAlternative(alt));
      meals.push({ slot: meal.slot, alternatives });
    }
    result.push({ name: menu.name, meals });
  }
  return result;
}

const toPlain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// Copia independiente de unos menús ya guardados (poblados o no).
async function copyMenus(menus) {
  return materializeMenus((menus || []).map(toPlain));
}

module.exports = {
  MAX_ALTERNATIVES,
  sanitizeAlternatives,
  sanitizeMeals,
  sanitizeMenus,
  materializeMenus,
  copyMenus,
};
