// Siembra el recetario verificado ("de fábrica"): recetas sin dueño y con
// `verified: true`, que la búsqueda enseña a todos los usuarios. Las recetas
// están en scripts/data/verified-recipes/ y sus ingredientes apuntan, por su
// `_id`, a Products reales de producción (pantry.js).
//
// Se lanza con el resto del contenido de fábrica: `npm run presets`
// (scripts/presets.js).
//
// Requisito: la base ya está en el modelo de datos de 2026-10 (ingredientes
// embebidos en la receta; npm run migrate). Si encuentra una
// receta con el formato viejo, no escribe nada.
//
// Idempotente: una receta verificada sin dueño con el mismo nombre ya existe
// y no se toca (ni se reescriben sus ingredientes, a los que pueden apuntar
// las modificaciones de los diarios). Si un producto de la despensa no está o
// su código de barras no coincide, las recetas que lo usan no se crean y el
// informe lo dice; las demás sí.
//
// Etiquetas: las de cada receta (desayuno, comida, cena…) más las que se
// deducen de lo que lleva: «vegetariana» y «vegana» por el `kind` de cada
// ingrediente y «alta en proteína» cuando la proteína aporta al menos el 20 %
// de la energía (criterio del Reglamento (CE) 1924/2006), con los valores de
// los productos tal como están en la base de datos.

const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const Recipe = require("../components/recipes/recipe-schema");
const recipeDao = require("../components/recipes/recipe-dao");
const { PANTRY, RECIPES } = require("./data/verified-recipes");


const TAG_VEGETARIAN = "vegetariana";
const TAG_VEGAN = "vegana";
const TAG_HIGH_PROTEIN = "alta en proteína";
const HIGH_PROTEIN_ENERGY_SHARE = 0.2;

const VEGETARIAN_KINDS = new Set(["huevo", "lacteo", "miel", "vegetal"]);

function dietTags(ingredients, pantry = PANTRY) {
  const kinds = ingredients.map(([key]) => pantry[key].kind);
  if (kinds.every((kind) => kind === "vegetal")) return [TAG_VEGETARIAN, TAG_VEGAN];
  if (kinds.every((kind) => VEGETARIAN_KINDS.has(kind))) return [TAG_VEGETARIAN];
  return [];
}

// `productsByKey`: el Product de cada clave de la despensa, con sus valores
// por 100 g. Sin energía conocida no se etiqueta.
function nutritionTags(ingredients, productsByKey) {
  let kcal = 0;
  let protein = 0;
  for (const [key, grams] of ingredients) {
    const product = productsByKey.get(key) || {};
    kcal += ((Number(product.energyKcal100g) || 0) * grams) / 100;
    protein += ((Number(product.protein100g) || 0) * grams) / 100;
  }
  if (kcal <= 0) return [];
  return (protein * 4) / kcal >= HIGH_PROTEIN_ENERGY_SHARE ? [TAG_HIGH_PROTEIN] : [];
}

// El documento Recipe tal como lo guardaría el editor de recetas de un admin
// (recipe-service.js#createOwnRecipe con `verified`): sin dueño, verificada,
// pasos en `description` separados por saltos de línea (el front los parte
// así) e ingredientes embebidos con su propio `_id`.
function buildRecipeDocument(recipe, { pantry = PANTRY, productsByKey = new Map() } = {}) {
  const tags = [...recipe.tags, ...dietTags(recipe.ingredients, pantry), ...nutritionTags(recipe.ingredients, productsByKey)];
  return {
    name: recipe.name,
    description: recipe.steps.join("\n"),
    tags: [...new Set(tags)],
    customProducts: recipe.ingredients.map(([key, quantity]) => ({
      _id: new mongoose.Types.ObjectId(),
      product: new mongoose.Types.ObjectId(pantry[key].product),
      quantity,
    })),
    verified: true,
  };
}

// Qué claves de la despensa se pueden usar: el producto existe y conserva su
// código de barras (un `_id` reutilizado para otro producto no cuela).
function checkPantry(pantry, products) {
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const productsByKey = new Map();
  const missing = [];
  const mismatched = [];
  for (const [key, entry] of Object.entries(pantry)) {
    const product = byId.get(entry.product);
    if (!product) missing.push(key);
    else if (String(product.code || "") !== entry.code) mismatched.push(key);
    else productsByKey.set(key, product);
  }
  return { productsByKey, missing, mismatched };
}

function planSeed({ recipes, availableKeys, existingNames }) {
  const toCreate = [];
  const existing = [];
  const blocked = [];
  for (const recipe of recipes) {
    if (existingNames.has(recipe.name)) {
      existing.push(recipe);
      continue;
    }
    const missingKeys = recipe.ingredients.map(([key]) => key).filter((key) => !availableKeys.has(key));
    if (missingKeys.length) blocked.push({ recipe, missingKeys });
    else toCreate.push(recipe);
  }
  return { toCreate, existing, blocked };
}

async function assertNewDataModel() {
  const legacy = await Recipe.collection.findOne({ "customProducts.0": { $type: "objectId" } }, { projection: { name: 1 } });
  if (legacy) {
    throw new Error(
      `La receta "${legacy.name}" (${legacy._id}) aún tiene los ingredientes en el formato viejo. ` +
        "Aplica antes npm run migrate.",
    );
  }
}

async function seedVerifiedRecipes({ recipes = RECIPES, pantry = PANTRY, dryRun = false, log = () => {} } = {}) {
  await assertNewDataModel();

  const productIds = Object.values(pantry).map((entry) => new mongoose.Types.ObjectId(entry.product));
  const products = await Product.find({ _id: { $in: productIds } })
    .select("code energyKcal100g protein100g")
    .lean();
  const { productsByKey, missing, mismatched } = checkPantry(pantry, products);
  for (const key of missing) log(`AVISO: falta el producto de "${key}": ${pantry[key].name} (${pantry[key].product})`);
  for (const key of mismatched) {
    log(`AVISO: el producto de "${key}" (${pantry[key].product}) ya no tiene el código ${pantry[key].code}: ${pantry[key].name}`);
  }

  const existingNames = new Set(
    await Recipe.find({ verified: true, userId: null, name: { $in: recipes.map((recipe) => recipe.name) } }).distinct("name"),
  );
  const { toCreate, existing, blocked } = planSeed({ recipes, availableKeys: new Set(productsByKey.keys()), existingNames });
  for (const { recipe, missingKeys } of blocked) log(`no se crea "${recipe.name}": faltan ${missingKeys.join(", ")}`);

  if (!dryRun) {
    for (const recipe of toCreate) {
      await recipeDao.insert(buildRecipeDocument(recipe, { pantry, productsByKey }));
    }
  }

  const stats = {
    recipes: recipes.length,
    created: dryRun ? 0 : toCreate.length,
    toCreate: toCreate.length,
    existing: existing.length,
    blocked: blocked.length,
    missingProducts: missing.length + mismatched.length,
  };
  log(JSON.stringify(stats));
  return stats;
}

module.exports = {
  TAG_HIGH_PROTEIN,
  TAG_VEGAN,
  TAG_VEGETARIAN,
  buildRecipeDocument,
  checkPantry,
  dietTags,
  nutritionTags,
  planSeed,
  seedVerifiedRecipes,
};
