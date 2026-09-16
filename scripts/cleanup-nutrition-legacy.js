const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Refactor nutrición / ciclos por contenido (2026-09) — quita de la base de
// datos lo que ya no lee ningún código. Complementa a reset-diet-cycles.js
// (que vacía DATOS del modelo viejo); esto borra ESTRUCTURA huérfana:
//
//   · Colecciones sin modelo: planassignments (migrate-diet-template-refs),
//     diets y dietexceptions (migrate-nutrition-model).
//   · users.dietInUse — el schema ya no lo declara (ver users/schema.js).
//   · DietTemplate asignadas (clientId) sin phaseId: el modelo de ciclos
//     exige que toda copia asignada pertenezca a una fase.
//
// Driver crudo a propósito: los campos/colecciones ya no existen en los
// schemas y mongoose los ignoraría.
//
// Uso:
//   node scripts/cleanup-nutrition-legacy.js --dry-run
//   node scripts/cleanup-nutrition-legacy.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[cleanup-nutrition-legacy]";
const log = (...a) => console.log(LOG, ...a);

const LEGACY_COLLECTIONS = ["planassignments", "diets", "dietexceptions"];

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const toDrop = LEGACY_COLLECTIONS.filter((name) => existing.has(name));
  for (const name of toDrop) log(`collection ${name}: ${await db.collection(name).countDocuments({})} docs`);

  const users = db.collection("users");
  const dietInUseFilter = { dietInUse: { $exists: true } };
  log(`users.dietInUse: ${await users.countDocuments(dietInUseFilter)}`);

  const templates = db.collection("diettemplates");
  const orphanFilter = { clientId: { $ne: null }, $or: [{ phaseId: null }, { phaseId: { $exists: false } }] };
  log(`diettemplates asignadas sin phaseId: ${await templates.countDocuments(orphanFilter)}`);

  if (DRY_RUN) {
    log("dry-run: nothing written");
    await mongoose.disconnect();
    return;
  }

  for (const name of toDrop) {
    await db.collection(name).drop();
    log(`dropped ${name}`);
  }
  const unset = await users.updateMany(dietInUseFilter, { $unset: { dietInUse: "" } });
  log(`users.dietInUse unset: ${unset.modifiedCount}`);

  // Con el modelo (no el driver) para que dispare la cascada a
  // CustomProduct/CustomRecipe del hook pre deleteMany del schema.
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const orphanIds = (await templates.find(orphanFilter).project({ _id: 1 }).toArray()).map((d) => d._id);
  if (orphanIds.length) {
    const res = await DietTemplate.deleteMany({ _id: { $in: orphanIds } });
    log(`diettemplates huérfanas borradas: ${res.deletedCount}`);
  }

  await mongoose.disconnect();
  log("done");
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
