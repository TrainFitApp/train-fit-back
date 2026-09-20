const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Revisiones (docs/plan-revisiones.md, 2026-09) — deja el entorno limpio del
// modelo viejo de ciclos y de check-ins. Sin migración: el modelo de check-in
// cambió de raíz (una respuesta por OCURRENCIA de una programación, con
// fechas de reloj sin zona horaria) y las respuestas antiguas no tienen a qué
// ocurrencia pertenecer.
//
// Borra:
//   · CheckinResponse (todas): sin scheduleId/occurrenceDate no encajan en el
//     índice único nuevo.
//   · Las colecciones que ya no existen: checkinrequests (las solicitudes se
//     calculan, no se materializan) y trainercheckintemplates (la cadencia la
//     pone la programación de cada cliente).
//   · DietTemplate — TODAS, biblioteca incluida: el contenido pasó de
//     `days`/`dayPatterns` (con `mode`) a una única lista de `menus`, y una
//     plantilla vieja se abriría vacía. Sus CustomProduct/CustomRecipe se
//     van en cascada.
//   · DietDay (en cascada con sus Meal).
//
// Limpia campos que el schema ya no declara (por la colección nativa: en
// strict, mongoose los ignoraría):
//   · CheckinSchedule: timeZone, nextRunAt, leaseUntil, leaseToken, legacyConfigId
//   · DietTemplate: mode, days, dayPatterns, choiceCycleDays, phaseFocus,
//     phaseTargetKcalDelta, targetRatePerCycle, cycleTargetKcal,
//     cycleTargetMacros, estimatedEndDate, endMode, cycleDays, stepGoal
//   · DietDay: steps (los pasos se pautan como hábito) y dayTypeName (el
//     menú elegido se guarda ahora en menuName)
//   · Meal: wasOverridden (el concepto "esta comida se cambió" se retiró;
//     saltarse un día es DietDay.skipped y no hay equivalente por comida)
//   · User: stepGoal
//   · NutritionalGoal: startDate, endMode, endDate
//
// Rellena lo que el modelo nuevo exige:
//   · Supplement.startDate = el día en que se creó (una pauta sin fecha se
//     estaba tomando desde que se escribió).
//
// Uso:
//   node scripts/reset-revisions.js --dry-run
//   node scripts/reset-revisions.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[reset-revisions]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  // Los hooks en cascada de DietTemplate/DietDay/Meal necesitan los modelos
  // registrados (mismo motivo que en reset-diet-cycles.js).
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");
  require("../components/meals/meal-schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const DietDay = require("../components/dietDays/diet-days-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const CheckinSchedule = require("../components/trainerCheckins/checkin-schedule-schema");
  const { Supplement } = require("../components/supplements/supplement-schema");
  const userSchema = require("../components/users/schema");
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");

  const counts = {
    checkinResponses: await CheckinResponse.countDocuments({}),
    checkinSchedules: await CheckinSchedule.countDocuments({}),
    dietTemplates: await DietTemplate.countDocuments({}),
    dietDays: await DietDay.countDocuments({}),
    supplementsWithoutDates: await Supplement.collection.countDocuments({ startDate: { $exists: false } }),
  };
  log("estado actual:", counts);

  if (DRY_RUN) {
    log("dry-run: nothing written");
    await mongoose.disconnect();
    return;
  }

  log(`CheckinResponse deleted: ${(await CheckinResponse.deleteMany({})).deletedCount}`);
  log(`DietTemplate deleted: ${(await DietTemplate.deleteMany({})).deletedCount}`);
  log(`DietDay deleted: ${(await DietDay.deleteMany({})).deletedCount}`);

  for (const name of ["checkinrequests", "trainercheckintemplates"]) {
    const exists = await mongoose.connection.db.listCollections({ name }).hasNext();
    if (!exists) continue;
    await mongoose.connection.db.dropCollection(name);
    log(`colección ${name} eliminada`);
  }

  // Los índices viejos (occurrenceKey único, cycle.*) no se caen solos.
  await mongoose.connection.db.collection("checkinresponses").dropIndexes().catch(() => {});
  await CheckinResponse.syncIndexes();
  await CheckinSchedule.syncIndexes();

  const schedules = await CheckinSchedule.collection.updateMany(
    {},
    { $unset: { timeZone: "", nextRunAt: "", leaseUntil: "", leaseToken: "", legacyConfigId: "" } }
  );
  log(`CheckinSchedule limpiadas: ${schedules.modifiedCount}`);

  const templates = await DietTemplate.collection.updateMany(
    {},
    {
      $unset: {
        mode: "",
        days: "",
        dayPatterns: "",
        choiceCycleDays: "",
        phaseFocus: "",
        phaseTargetKcalDelta: "",
        targetRatePerCycle: "",
        cycleTargetKcal: "",
        cycleTargetMacros: "",
        estimatedEndDate: "",
        endMode: "",
        cycleDays: "",
        stepGoal: "",
      },
    }
  );
  log(`DietTemplate limpiadas: ${templates.modifiedCount}`);

  log(
    `DietDay limpiados: ${
      (await DietDay.collection.updateMany({}, { $unset: { steps: "", dayTypeName: "" } })).modifiedCount
    }`
  );
  const mealSchema = require("../components/meals/meal-schema");
  log(
    `Meal.wasOverridden quitado: ${
      (await mealSchema.collection.updateMany({}, { $unset: { wasOverridden: "" } })).modifiedCount
    }`
  );
  log(`User.stepGoal quitado: ${(await userSchema.collection.updateMany({}, { $unset: { stepGoal: "" } })).modifiedCount}`);
  log(
    `NutritionalGoal limpiados: ${
      (await NutritionalGoal.collection.updateMany({}, { $unset: { startDate: "", endMode: "", endDate: "" } }))
        .modifiedCount
    }`
  );

  let backfilled = 0;
  for (const supplement of await Supplement.collection.find({ startDate: { $exists: false } }).toArray()) {
    const startDate = new Date(supplement.createdAt || Date.now()).toISOString().slice(0, 10);
    await Supplement.collection.updateOne({ _id: supplement._id }, { $set: { startDate, endDate: null } });
    backfilled++;
  }
  log(`Supplement con fechas: ${backfilled}`);

  await mongoose.disconnect();
  log("done");
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
