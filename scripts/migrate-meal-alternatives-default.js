const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Opciones de comida (2026-09) — una comida con 2+ alternativas ya no
// espera a que el cliente elija: nace con la opción 1 aplicada. Los días
// creados antes de ese cambio quedaron con alternativas y la comida vacía
// (chosenAlternativeIndex null). Este script les aplica la opción 1 con la
// misma pieza que usa la app (meal-proposal-dao.js#choose), así que lo que
// el cliente hubiera añadido por su cuenta a esa comida se conserva.
//
// Uso:
//   node scripts/migrate-meal-alternatives-default.js --dry-run
//   node scripts/migrate-meal-alternatives-default.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[migrate-meal-alternatives-default]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  // Modelos que toca el autopopulate de Meal/CustomProduct/CustomRecipe.
  require("../components/users/schema");
  require("../components/products/product-schema");
  require("../components/recipes/recipe-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  const Meal = require("../components/meals/meal-schema");
  const mealProposalDao = require("../components/mealProposals/meal-proposal-dao");

  const pending = await Meal.find({
    trainerId: null,
    chosenAlternativeIndex: null,
    "alternatives.0": { $exists: true },
  })
    .select("_id name alternatives")
    .lean();
  log(`comidas con alternativas sin elegir: ${pending.length}`);

  let applied = 0;
  for (const meal of pending) {
    const alternative = meal.alternatives[0];
    const size = (alternative.customProducts || []).length + (alternative.customRecipes || []).length;
    log(`  ${meal._id} ${meal.name}: aplicar "${alternative.label}" (${size} items)`);
    if (DRY_RUN) continue;
    const updated = await mealProposalDao.choose(meal._id, 0);
    if (updated) applied += 1;
  }

  log(`aplicadas: ${applied}${DRY_RUN ? " (dry-run, sin cambios)" : ""}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(LOG, error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
