const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const fs = require("fs");
const os = require("os");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { buildSearchFields } = require("../components/util/search-index");

/**
 * DATOS DE DEMO para "sugerencias de dieta" (rama feat/diet-suggestions).
 *
 * Siembra 7 dietas de biblioteca alrededor del objetivo de Lucía Márquez
 * (demo) para poder ver el ranking, el filtro de origen y el prefill de
 * restricciones:
 *   - 5 generales de Santiago (el trainer demo): equilibrada / alta en
 *     proteína / volumen / vegana / vegetariana.
 *   - 1 `verified` ("de fábrica") de OTRO trainer -> prueba el origen
 *     "De fábrica" sin colarse por las generales de Santiago.
 *   - 1 propia de Lucía (`ownerClientId`) -> prueba "De este cliente".
 * Y pone `dietaryFlags: ['vegetarian']` en las preferencias de Lucía para
 * ver el prefill del cajón.
 *
 * PARANOIA (corre contra `pre`, Atlas compartido):
 *   - todo lleva el sufijo " [seed-ds]" en el nombre.
 *   - `--clean` borra EXACTAMENTE lo sembrado, por manifiesto y, de red de
 *     seguridad, por ese sufijo. El contenido de cada plantilla va dentro
 *     de ella y se borra con ella.
 *   - la preferencia de Lucía se restaura a como estaba (o se borra el doc
 *     si no existía).
 *
 * USO
 *   node scripts/seed-diet-suggestions-demo.js           -> siembra
 *   node scripts/seed-diet-suggestions-demo.js --clean    -> limpia
 */

const SANTIAGO = "6a86feb4a4a80dd5286b0595"; // trainer demo (Santiago González)
const OTHER_TRAINER = "6a882e2fd13d70406fa6b1a2"; // "autor" de la dieta de fábrica
const LUCIA = "af90df5508256c695673d0ec"; // cliente demo
const MARK = " [seed-ds]";
const NAME_RX = "\\[seed-ds\\]$";
const MANIFEST = path.join(os.tmpdir(), "trainfit-seed-diet-suggestions.json");

const clean = process.argv.includes("--clean");

function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-seed-ds:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

// Los alimentos son Product REALES, no macros sueltas: una plantilla de
// biblioteca guarda {product, quantity} y todo lo que la lee (constructor
// del entrenador, perfil de macros, aptitud vegana/sin gluten) saca los
// datos del Product poblado. Sembrar CustomProducts sin `product` colaba en
// base de datos pero el constructor no podía pintarlos: la dieta se abría
// vacía y al guardarla esos alimentos se perdían.
//
// quantity:100 => el aporte del producto == sus *_100g
const FOODS = new Map();
const P = (name, kcal, protein, carbs, fat, flags) => {
  const _id = oid("product:" + name);
  if (!FOODS.has(name)) {
    const fullName = name + MARK;
    FOODS.set(name, {
      _id,
      name: fullName,
      userId: new mongoose.Types.ObjectId(SANTIAGO),
      energyKcal100g: kcal,
      protein100g: protein,
      carbohydrates100g: carbs,
      fat100g: fat,
      vegan: !!flags.vegan,
      vegetarian: !!flags.vegetarian,
      lactoseFree: !!flags.lactoseFree,
      glutenFree: !!flags.glutenFree,
      ...buildSearchFields({ name: fullName }),
    });
  }
  return { quantity: 100, product: _id };
};

const menu = (products) => [
  { name: "Menú 1", meals: [{ slot: "Comida", alternatives: [{ label: "", customProducts: products, customRecipes: [] }] }] },
];

const OMNI = { lactoseFree: true, glutenFree: true };
const VEGAN = { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true };
const VEG = { vegetarian: true, glutenFree: true };
const GF = { glutenFree: true };

// trainerId, nombre, days, ownerClientId, verified   (target Lucía ≈ 1743/103/202/58)
const TEMPLATES = [
  [SANTIAGO, "Definición equilibrada" + MARK, menu([P("Equilibrada comida", 1000, 70, 120, 25, OMNI), P("Equilibrada cena", 750, 35, 80, 33, OMNI)]), null, false],
  [SANTIAGO, "Alto en proteína" + MARK, menu([P("Proteica comida", 950, 105, 60, 28, OMNI), P("Proteica cena", 750, 45, 60, 27, OMNI)]), null, false],
  [SANTIAGO, "Volumen limpio" + MARK, menu([P("Volumen comida", 1400, 95, 160, 42, GF), P("Volumen cena", 1200, 70, 140, 38, GF)]), null, false],
  [SANTIAGO, "Vegana flexible" + MARK, menu([P("Vegana comida", 1000, 52, 128, 28, VEGAN), P("Vegana cena", 760, 40, 86, 27, VEGAN)]), null, false],
  [SANTIAGO, "Vegetariana mediterránea" + MARK, menu([P("Vegetariana comida", 1100, 65, 110, 40, VEG), P("Vegetariana cena", 790, 43, 78, 26, VEG)]), null, false],
  [OTHER_TRAINER, "Plan definición estándar TF" + MARK, menu([P("Plato estándar TF", 1785, 110, 190, 60, GF)]), null, true],
  [SANTIAGO, "Pescado y verdura (Lucía)" + MARK, menu([P("Pescado y verdura", 1720, 132, 150, 54, OMNI)]), LUCIA, false],
];

async function main() {
  const uri = buildMongoUri();
  console.log("[seed-ds]", clean ? "CLEAN" : "SEED", redactMongoUri(uri));
  await mongoose.connect(uri);

  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const { contentMacroProfile } = require("../components/dietTemplates/diet-macro-profile");
  const User = require("../components/users/user-schema");
  // Las preferencias de nutrición viven en User.nutritionPreferences.
  const readPrefs = async () => (await User.findById(LUCIA).select("nutritionPreferences").lean())?.nutritionPreferences || null;
  const dropPrefs = () => User.updateOne({ _id: LUCIA }, { $unset: { nutritionPreferences: 1 } });
  const setFlags = (flags) => User.updateOne({ _id: LUCIA }, { $set: { "nutritionPreferences.dietaryFlags": flags } });
  const Product = require("../components/products/product-schema");
  require("../components/recipes/recipe-schema");

  if (clean) {
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* noop */ }

    const ids = manifest.templateIds || [];
    if (ids.length) {
      await DietTemplate.deleteMany({ _id: { $in: ids } });
      console.log("[seed-ds] borradas", ids.length, "plantillas por manifiesto");
    }
    const leftover = await DietTemplate.deleteMany({ name: { $regex: NAME_RX } });
    if (leftover.deletedCount) console.log("[seed-ds] borrados", leftover.deletedCount, "restos por nombre");

    // Después de las plantillas (su contenido va dentro y se borra con ellas).
    const foods = await Product.deleteMany({ _id: { $in: [...FOODS.values()].map((f) => f._id) } });
    if (foods.deletedCount) console.log("[seed-ds] borrados", foods.deletedCount, "alimentos");

    if (manifest.luciaPrefs === "created") {
      await dropPrefs();
      console.log("[seed-ds] prefs de Lucía borradas (no existían antes)");
    } else if (manifest.luciaPrefs && typeof manifest.luciaPrefs === "object") {
      await setFlags(manifest.luciaPrefs.dietaryFlags || []);
      console.log("[seed-ds] dietaryFlags de Lucía restaurados a", JSON.stringify(manifest.luciaPrefs.dietaryFlags || []));
    } else {
      // Sin manifiesto: si el doc parece sembrado (solo dietaryFlags), fuera.
      const p = await readPrefs();
      if (p && JSON.stringify(p.dietaryFlags) === JSON.stringify(["vegetarian"]) && !p.allergies && !p.favoriteFoods && !p.dislikedFoods) {
        await dropPrefs();
        console.log("[seed-ds] prefs de Lucía borradas (heurística sin manifiesto)");
      }
    }

    try { fs.unlinkSync(MANIFEST); } catch { /* noop */ }
    await mongoose.disconnect();
    console.log("[seed-ds] limpio");
    return;
  }

  // idempotencia: restos de una corrida anterior fuera antes de re-sembrar.
  await DietTemplate.deleteMany({ name: { $regex: NAME_RX } });

  for (const food of FOODS.values()) {
    await Product.updateOne({ _id: food._id }, { $set: food }, { upsert: true });
  }
  console.log("[seed-ds]", FOODS.size, "alimentos en el catálogo de Santiago");

  const templateIds = [];
  for (const [trainerId, name, menus, ownerClientId, verified] of TEMPLATES) {
    const created = await dietTemplateDao.create(trainerId, { name, menus, ownerClientId, verified });
    templateIds.push(created._id.toString());
    const prof = contentMacroProfile(created.toObject());
    console.log(
      `  + ${name}  ->  ${prof.kcal} kcal P${prof.protein} C${prof.carbs} G${prof.fat}` +
      `  | suitableFor ${JSON.stringify(created.suitableFor)}` +
      `${verified ? " | VERIFIED" : ""}${ownerClientId ? " | ownerClientId=Lucía" : ""}`
    );
  }

  const existing = await readPrefs();
  let luciaPrefs;
  if (existing) {
    luciaPrefs = { dietaryFlags: existing.dietaryFlags || [] };
    await setFlags(["vegetarian"]);
    console.log("[seed-ds] Lucía ya tenía prefs; dietaryFlags -> ['vegetarian'] (previo:", JSON.stringify(luciaPrefs.dietaryFlags), ")");
  } else {
    luciaPrefs = "created";
    await User.updateOne(
      { _id: LUCIA },
      {
        $set: {
          nutritionPreferences: {
            dietaryFlags: ["vegetarian"],
            requestedBy: SANTIAGO,
            requestedAt: new Date(),
            respondedAt: new Date(),
          },
        },
      }
    );
    console.log("[seed-ds] creadas prefs de Lucía con dietaryFlags ['vegetarian']");
  }

  fs.writeFileSync(MANIFEST, JSON.stringify({ templateIds, luciaPrefs, at: new Date().toISOString() }, null, 2));
  console.log("[seed-ds] manifiesto ->", MANIFEST);
  await mongoose.disconnect();
  console.log("[seed-ds] hecho:", templateIds.length, "plantillas");
}

main().catch((e) => { console.error(e); process.exit(1); });
