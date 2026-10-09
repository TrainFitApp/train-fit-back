// Siembra las dietas de fábrica: plantillas de dieta de biblioteca con
// `verified: true`, que salen a todos los profesionales en las sugerencias de
// dieta y en «De fábrica». Están en scripts/data/verified-diets/ y sus
// alimentos son claves de la despensa de las recetas verificadas
// (data/verified-recipes/pantry.js), que apunta por `_id` a Products reales de
// producción.
//
// Se lanza con el resto del contenido de fábrica: `npm run presets`
// (scripts/presets.js).
//
// Una plantilla siempre tiene autor (`trainerId`) y solo un admin puede
// marcarla de fábrica: con `npm run presets -- --owner=<email>` se elige qué
// admin la firma; sin él, el admin más antiguo de la base.
//
// Requisito: la base ya está en el modelo de datos de 2026-10 (contenido de
// las plantillas embebido y las fases fuera de `diettemplates`; npm run
// migrate). Si encuentra una plantilla con el formato viejo, no
// escribe nada.
//
// Idempotente: una dieta de fábrica con el mismo nombre ya existe y no se
// toca. Si un producto de la despensa no está o su código de barras no
// coincide, las dietas que lo usan no se crean y el informe lo dice; las demás
// sí. Para cada menú, el informe da la energía y los macros con los valores de
// la base y avisa si se aleja más de un 5 % de su objetivo.

const mongoose = require("mongoose");
const Product = require("../components/products/product-schema");
const User = require("../components/users/user-schema");
const DietTemplate = require("../components/dietTemplates/diet-template-schema");
const dietTemplateService = require("../components/dietTemplates/diet-template-service");
const { checkPantry } = require("./seed-verified-recipes");
const { DIETS, PANTRY } = require("./data/verified-diets");
const { ensureGenericProducts, pantryWithGenerics } = require("./lib/generic-products");


const KCAL_TOLERANCE = 0.05;
const VEGETARIAN_KINDS = new Set(["huevo", "lacteo", "miel", "vegetal"]);

function dietFoodKeys(diet) {
  const keys = diet.menus.flatMap((menu) =>
    menu.meals.flatMap((meal) => meal.alternatives.flatMap((alternative) => alternative.foods.map(([key]) => key))),
  );
  return [...new Set(keys)];
}

// Aptitudes que se pueden garantizar por lo que lleva: sin carne ni pescado,
// vegetariana; todo de origen vegetal, además vegana. Se guardan como
// `suitableForOverride` porque los productos del catálogo casi nunca traen
// esos flags (la aptitud derivada saldría vacía). Sin gluten y sin lactosa no
// se afirman: dependen de la marca de cada producto.
function dietaryFlags(diet, pantry = PANTRY) {
  const kinds = dietFoodKeys(diet).map((key) => pantry[key].kind);
  if (kinds.every((kind) => kind === "vegetal")) return ["vegan", "vegetarian"];
  if (kinds.every((kind) => VEGETARIAN_KINDS.has(kind))) return ["vegetarian"];
  return [];
}

// Los menús tal como los manda el constructor de plantillas de la app de
// entrenadores: cada alimento es { product, quantity } (el servicio los sanea
// y les da ids).
function buildMenus(diet, pantry = PANTRY) {
  return diet.menus.map((menu) => ({
    name: menu.name,
    meals: menu.meals.map((meal) => ({
      slot: meal.slot,
      alternatives: meal.alternatives.map((alternative) => ({
        label: alternative.label,
        customProducts: alternative.foods.map(([key, quantity], order) => ({
          product: new mongoose.Types.ObjectId(pantry[key].product),
          quantity,
          order,
        })),
        customRecipes: [],
      })),
    })),
  }));
}

// Un día de un menú con los valores por 100 g de cada producto: cada comida
// cuenta la media de sus opciones (mismo criterio que
// dietTemplates/diet-macro-profile.js, el del cajón de sugerencias).
function menuMacros(menu, productsByKey) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const meal of menu.meals) {
    const share = 1 / meal.alternatives.length;
    for (const alternative of meal.alternatives) {
      for (const [key, grams] of alternative.foods) {
        const product = productsByKey.get(key) || {};
        const factor = (grams / 100) * share;
        total.kcal += (Number(product.energyKcal100g) || 0) * factor;
        total.protein += (Number(product.protein100g) || 0) * factor;
        total.carbs += (Number(product.carbohydrates100g) || 0) * factor;
        total.fat += (Number(product.fat100g) || 0) * factor;
      }
    }
  }
  return Object.fromEntries(Object.entries(total).map(([field, value]) => [field, Math.round(value)]));
}

function describeMenu(menu, productsByKey) {
  const macros = menuMacros(menu, productsByKey);
  const deviation = macros.kcal / menu.target.kcal - 1;
  const line =
    `${menu.name}: ${macros.kcal} kcal · P${macros.protein} C${macros.carbs} G${macros.fat}` +
    ` (objetivo ${menu.target.kcal} kcal, ${menu.target.protein} g de proteína)`;
  return Math.abs(deviation) > KCAL_TOLERANCE ? `AVISO: ${line}, se aleja un ${Math.round(deviation * 100)} %` : line;
}

function planSeed({ diets, availableKeys, existingNames }) {
  const toCreate = [];
  const existing = [];
  const blocked = [];
  for (const diet of diets) {
    if (existingNames.has(diet.name)) {
      existing.push(diet);
      continue;
    }
    const missingKeys = dietFoodKeys(diet).filter((key) => !availableKeys.has(key));
    if (missingKeys.length) blocked.push({ diet, missingKeys });
    else toCreate.push(diet);
  }
  return { toCreate, existing, blocked };
}

async function assertNewDataModel() {
  const legacy = await DietTemplate.collection.findOne(
    {
      $or: [
        { "menus.meals.alternatives.customProducts": { $type: "objectId" } },
        { "menus.meals.alternatives.customRecipes": { $type: "objectId" } },
        { clientId: { $exists: true } },
      ],
    },
    { projection: { name: 1 } },
  );
  if (legacy) {
    throw new Error(
      `La plantilla de dieta "${legacy.name}" (${legacy._id}) aún tiene el formato viejo. ` +
        "Aplica antes npm run migrate.",
    );
  }
}

// El admin que firma las dietas: el del email pedido, o el más antiguo.
async function resolveOwner(ownerEmail) {
  const filter = ownerEmail ? { email: String(ownerEmail).trim().toLowerCase() } : { roles: "admin" };
  const owner = await User.findOne(filter).sort({ _id: 1 }).select("email roles").lean();
  if (!owner) throw new Error(ownerEmail ? `No hay ningún usuario con el email ${ownerEmail}.` : "No hay ningún admin en la base.");
  if (!(owner.roles || []).includes("admin")) throw new Error(`${owner.email} no es admin: solo un admin firma dietas de fábrica.`);
  return owner;
}

async function seedVerifiedDiets({ diets = DIETS, pantry = PANTRY, ownerEmail = null, dryRun = false, log = () => {} } = {}) {
  await assertNewDataModel();
  const owner = await resolveOwner(ownerEmail);
  log(`firma ${owner.email} (${owner._id})`);

  const productIds = Object.values(pantry).map((entry) => new mongoose.Types.ObjectId(entry.product));
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const checked = checkPantry(pantry, products);
  const { missing, mismatched } = checked;
  const used = new Set(diets.flatMap(dietFoodKeys));
  const lost = [...missing, ...mismatched].filter((key) => used.has(key));
  for (const key of missing.filter((item) => used.has(item))) {
    log(`AVISO: falta el producto de "${key}": ${pantry[key].name} (${pantry[key].product})`);
  }
  for (const key of mismatched.filter((item) => used.has(item))) {
    log(`AVISO: el producto de "${key}" (${pantry[key].product}) ya no tiene el código ${pantry[key].code}: ${pantry[key].name}`);
  }

  // Alimentos genéricos en español (lib/generic-products.js), con los
  // valores del producto de referencia de la despensa.
  const productsByKey = await ensureGenericProducts(pantry, checked.productsByKey, { dryRun, log });
  pantry = pantryWithGenerics(pantry, productsByKey);

  const existingNames = new Set(
    await DietTemplate.find({ verified: true, name: { $in: diets.map((diet) => diet.name) } }).distinct("name"),
  );
  const { toCreate, existing, blocked } = planSeed({ diets, availableKeys: new Set(productsByKey.keys()), existingNames });
  for (const diet of existing) log(`ya existe "${diet.name}"`);
  for (const { diet, missingKeys } of blocked) log(`no se crea "${diet.name}": faltan ${missingKeys.join(", ")}`);

  for (const diet of toCreate) {
    const flags = dietaryFlags(diet, pantry);
    log(`${dryRun ? "se crearía" : "crea"} "${diet.name}"${flags.length ? ` (${flags.join(", ")})` : ""}`);
    for (const menu of diet.menus) log(`  ${describeMenu(menu, productsByKey)}`);
    if (dryRun) continue;
    const created = await dietTemplateService.create(owner._id, { name: diet.name, menus: buildMenus(diet, pantry), verified: true });
    if (flags.length) await dietTemplateService.update(owner._id, created._id, { suitableForOverride: flags });
  }

  const stats = {
    diets: diets.length,
    created: dryRun ? 0 : toCreate.length,
    toCreate: toCreate.length,
    existing: existing.length,
    blocked: blocked.length,
    missingProducts: lost.length,
  };
  log(JSON.stringify(stats));
  return stats;
}

module.exports = {
  buildMenus,
  dietFoodKeys,
  dietaryFlags,
  menuMacros,
  planSeed,
  seedVerifiedDiets,
};
