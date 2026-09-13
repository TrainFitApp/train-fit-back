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
//   · NutritionalGoal asignados por trainer (los de ciclo lo eran).
//   · DietDay (todos), en cascada con Meal → CustomProduct/CustomRecipe.
//   · CheckinResponse (todos).
//   · PlanChange de nutrición (diet_plan / nutritional_goal).
// Repunta User.goalInUse a null si apuntaba a un objetivo borrado.
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
  const User = require("../components/users/schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const DietDay = require("../components/dietDays/diet-days-schema");
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const PlanChange = require("../components/planChanges/plan-change-schema");

  const assignedFilter = { clientId: { $ne: null } };
  // OJO: solo campos que sigan en el schema. Con strictQuery, un campo que ya
  // no exista en NutritionalGoalSchema se elimina del filtro y {$or:[{}]}
  // borra TODO — pasó en la primera ejecución en pre (phaseId/cycleId ya
  // se habían quitado del schema). Los goals de ciclo viejos se reconocen
  // por assignedByTrainerId, que sí sigue existiendo.
  const goalFilter = { assignedByTrainerId: { $ne: null } };
  const planChangeFilter = { entityType: { $in: ["diet_plan", "nutritional_goal"] } };

  const counts = {
    assignedTemplates: await DietTemplate.countDocuments(assignedFilter),
    goals: await NutritionalGoal.countDocuments(goalFilter),
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

  // Orden: primero los objetivos (para saber qué goalInUse repuntar), luego
  // el resto. deleteMany (no la colección nativa) para que disparen los hooks.
  const goalIds = (await NutritionalGoal.find(goalFilter).select("_id").lean()).map((g) => g._id);
  const goalsRes = await NutritionalGoal.deleteMany(goalFilter);
  log(`NutritionalGoal deleted: ${goalsRes.deletedCount}`);
  if (goalIds.length) {
    const usersRes = await User.updateMany({ goalInUse: { $in: goalIds } }, { $set: { goalInUse: null } });
    log(`User.goalInUse reset: ${usersRes.modifiedCount}`);
  }

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
