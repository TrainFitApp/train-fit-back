const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Ciclos por contenido (docs/plan-ciclos-por-contenido.md, 2026-09) — vacía
// todo el dato del modelo viejo de fases/ciclos en el entorno `pre`. Sin
// migración: el entrenador quiere empezar de cero.
//
// Borra:
//   · DietTemplate con clientId (copias asignadas = fases/ciclos), en cascada
//     con sus CustomProduct/CustomRecipe (hook pre deleteMany del schema).
//   · DietDay (todos), en cascada con Meal → CustomProduct/CustomRecipe.
//   · CheckinResponse (todos).
//   · PlanChange de nutrición (diet_plan / nutritional_goal).
// Quita de las plantillas de biblioteca los campos que ya no existen en el
// schema (cycleTargetKcal, cycleTargetMacros, estimatedEndDate, endMode,
// cycleDays) — por la colección nativa, mongoose en strict los ignoraría.
//
// Uso:
//   node scripts/reset-diet-cycles.js --dry-run
//   node scripts/reset-diet-cycles.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[reset-diet-cycles]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  // Los hooks en cascada de DietTemplate/DietDay/Meal necesitan los modelos
  // registrados (mismo motivo que en migrate-diet-phases.js).
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");
  require("../components/meals/meal-schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const DietDay = require("../components/dietDays/diet-days-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const PlanChange = require("../components/planChanges/plan-change-schema");

  const assignedFilter = { clientId: { $ne: null } };
  const planChangeFilter = { entityType: { $in: ["diet_plan", "nutritional_goal"] } };

  const counts = {
    assignedTemplates: await DietTemplate.countDocuments(assignedFilter),
    dietDays: await DietDay.countDocuments({}),
    checkinResponses: await CheckinResponse.countDocuments({}),
    planChanges: await PlanChange.countDocuments(planChangeFilter),
    libraryTemplates: await DietTemplate.countDocuments({ clientId: null }),
  };
  log("to delete:", counts);

  if (DRY_RUN) {
    log("dry-run: nothing written");
    await mongoose.disconnect();
    return;
  }

  // deleteMany (no la colección nativa) para que disparen los hooks.

  const templatesRes = await DietTemplate.deleteMany(assignedFilter);
  log(`DietTemplate (assigned) deleted: ${templatesRes.deletedCount}`);

  const daysRes = await DietDay.deleteMany({});
  log(`DietDay deleted: ${daysRes.deletedCount}`);

  const checkinsRes = await CheckinResponse.deleteMany({});
  log(`CheckinResponse deleted: ${checkinsRes.deletedCount}`);

  const changesRes = await PlanChange.deleteMany(planChangeFilter);
  log(`PlanChange (nutrition) deleted: ${changesRes.deletedCount}`);

  const unsetRes = await DietTemplate.collection.updateMany(
    {},
    {
      $unset: {
        cycleTargetKcal: "",
        cycleTargetMacros: "",
        estimatedEndDate: "",
        endMode: "",
        cycleDays: "",
        phaseId: "",
        phaseName: "",
        phaseFocus: "",
        phaseTargetKcalDelta: "",
        targetRatePerCycle: "",
      },
    }
  );
  log(`library templates cleaned: ${unsetRes.modifiedCount}`);

  await mongoose.disconnect();
  log("done");
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
