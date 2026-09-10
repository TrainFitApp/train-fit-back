const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const fs = require("fs");
const os = require("os");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

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
 *     seguridad, por ese sufijo. La cascada de pre('deleteMany') de
 *     DietTemplate se lleva los CustomProduct.
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

// quantity:100 => el aporte del producto == sus *_100g
const P = (kcal, protein, carbs, fat, flags) => ({
  quantity: 100,
  energyKcal100g: kcal,
  protein100g: protein,
  carbohydrates100g: carbs,
  fat100g: fat,
  vegan: !!flags.vegan,
  vegetarian: !!flags.vegetarian,
  lactoseFree: !!flags.lactoseFree,
  glutenFree: !!flags.glutenFree,
});

const day = (products) => [
  { dayLabel: "Día 1", meals: [{ slot: "Comida", alternatives: [{ label: "", customProducts: products, customRecipes: [] }] }] },
];

const OMNI = { lactoseFree: true, glutenFree: true };
const VEGAN = { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true };
const VEG = { vegetarian: true, glutenFree: true };

// trainerId, nombre, days, ownerClientId, verified   (target Lucía ≈ 1743/103/202/58)
const TEMPLATES = [
  [SANTIAGO, "Definición equilibrada" + MARK, day([P(1000, 70, 120, 25, OMNI), P(750, 35, 80, 33, OMNI)]), null, false],
  [SANTIAGO, "Alto en proteína" + MARK, day([P(950, 105, 60, 28, OMNI), P(750, 45, 60, 27, OMNI)]), null, false],
  [SANTIAGO, "Volumen limpio" + MARK, day([P(1400, 95, 160, 42, { glutenFree: true }), P(1200, 70, 140, 38, { glutenFree: true })]), null, false],
  [SANTIAGO, "Vegana flexible" + MARK, day([P(1000, 52, 128, 28, VEGAN), P(760, 40, 86, 27, VEGAN)]), null, false],
  [SANTIAGO, "Vegetariana mediterránea" + MARK, day([P(1100, 65, 110, 40, VEG), P(790, 43, 78, 26, VEG)]), null, false],
  [OTHER_TRAINER, "Plan definición estándar TF" + MARK, day([P(1785, 110, 190, 60, { glutenFree: true })]), null, true],
  [SANTIAGO, "Pescado y verdura (Lucía)" + MARK, day([P(1720, 132, 150, 54, OMNI)]), LUCIA, false],
];

async function main() {
  const uri = buildMongoUri();
  console.log("[seed-ds]", clean ? "CLEAN" : "SEED", redactMongoUri(uri));
  await mongoose.connect(uri);

  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const NP = require("../components/nutritionPreferences/nutrition-preferences-schema");
  const { cycleMacroProfile } = require("../components/dietTemplates/diet-macro-profile");
  require("../components/users/schema");
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");

  if (clean) {
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* noop */ }

    const ids = manifest.templateIds || [];
    if (ids.length) {
      await DietTemplate.deleteMany({ _id: { $in: ids } });
      console.log("[seed-ds] borradas", ids.length, "plantillas por manifiesto (+ CustomProducts en cascada)");
    }
    const leftover = await DietTemplate.deleteMany({ name: { $regex: NAME_RX } });
    if (leftover.deletedCount) console.log("[seed-ds] borrados", leftover.deletedCount, "restos por nombre");

    if (manifest.luciaPrefs === "created") {
      await NP.deleteOne({ clientId: LUCIA });
      console.log("[seed-ds] prefs de Lucía borradas (no existían antes)");
    } else if (manifest.luciaPrefs && typeof manifest.luciaPrefs === "object") {
      await NP.updateOne({ clientId: LUCIA }, { $set: { dietaryFlags: manifest.luciaPrefs.dietaryFlags || [] } });
      console.log("[seed-ds] dietaryFlags de Lucía restaurados a", JSON.stringify(manifest.luciaPrefs.dietaryFlags || []));
    } else {
      // Sin manifiesto: si el doc parece sembrado (solo dietaryFlags), fuera.
      const p = await NP.findOne({ clientId: LUCIA }).lean();
      if (p && JSON.stringify(p.dietaryFlags) === JSON.stringify(["vegetarian"]) && !p.allergies && !p.favoriteFoods && !p.dislikedFoods) {
        await NP.deleteOne({ clientId: LUCIA });
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

  const templateIds = [];
  for (const [trainerId, name, days, ownerClientId, verified] of TEMPLATES) {
    const created = await dietTemplateDao.create(trainerId, name, days, "sequential", [], ownerClientId, verified);
    templateIds.push(created._id.toString());
    const prof = cycleMacroProfile(created.toObject());
    console.log(
      `  + ${name}  ->  ${prof.kcal} kcal P${prof.protein} C${prof.carbs} G${prof.fat}` +
      `  | suitableFor ${JSON.stringify(created.suitableFor)}` +
      `${verified ? " | VERIFIED" : ""}${ownerClientId ? " | ownerClientId=Lucía" : ""}`
    );
  }

  const existing = await NP.findOne({ clientId: LUCIA }).lean();
  let luciaPrefs;
  if (existing) {
    luciaPrefs = { dietaryFlags: existing.dietaryFlags || [] };
    await NP.updateOne({ clientId: LUCIA }, { $set: { dietaryFlags: ["vegetarian"] } });
    console.log("[seed-ds] Lucía ya tenía prefs; dietaryFlags -> ['vegetarian'] (previo:", JSON.stringify(luciaPrefs.dietaryFlags), ")");
  } else {
    luciaPrefs = "created";
    await NP.create({
      clientId: LUCIA,
      dietaryFlags: ["vegetarian"],
      requestedBy: SANTIAGO,
      requestedAt: new Date(),
      respondedAt: new Date(),
    });
    console.log("[seed-ds] creadas prefs de Lucía con dietaryFlags ['vegetarian']");
  }

  fs.writeFileSync(MANIFEST, JSON.stringify({ templateIds, luciaPrefs, at: new Date().toISOString() }, null, 2));
  console.log("[seed-ds] manifiesto ->", MANIFEST);
  await mongoose.disconnect();
  console.log("[seed-ds] hecho:", templateIds.length, "plantillas");
}

main().catch((e) => { console.error(e); process.exit(1); });
