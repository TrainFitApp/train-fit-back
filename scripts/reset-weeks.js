const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Semanas (docs/plan-semanas.md, 2026-09) — deja el entorno limpio del modelo
// de REVISIONES. Sin migración, por decisión: las revisiones las cortaban los
// check-ins, así que el contenido de dieta ya asignado empieza en fechas
// sueltas que no son lunes y no encaja en ninguna semana natural.
//
// Borra:
//   · DietTemplate — TODAS, biblioteca incluida: el contenido asignado
//     arrancaba en fechas de check-in. Sus CustomProduct/CustomRecipe se van
//     en cascada.
//   · DietDay (en cascada con sus Meal): sin plantilla no hay día que resolver.
//   · CheckinResponse (todas): llevaban sellada la revisión a la que
//     pertenecían, y ese número ya no significa nada.
//
// NO se toca:
//   · CheckinSchedule — las programaciones siguen valiendo tal cual: ahora
//     son formularios dentro de una semana, no la marcan.
//   · Anthropometry, TrainerTask/TaskCompletion, Supplement, NutritionalGoal.
//
// Después hay que volver a asignar dieta a cada cliente.
//
// Uso:
//   node scripts/reset-weeks.js --dry-run
//   node scripts/reset-weeks.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[reset-weeks]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  // Los hooks en cascada de DietTemplate/DietDay/Meal necesitan los modelos
  // registrados antes de pedir los schemas que los usan.
  require("../components/products/product-schema");
  require("../components/customProducts/custom-product-schema");
  require("../components/customRecipes/custom-recipe-schema");
  require("../components/recipes/recipe-schema");
  require("../components/meals/meal-schema");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const DietDay = require("../components/dietDays/diet-days-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");

  const counts = {
    dietTemplates: await DietTemplate.countDocuments({}),
    dietDays: await DietDay.countDocuments({}),
    checkinResponses: await CheckinResponse.countDocuments({}),
    respuestasSelladas: await CheckinResponse.collection.countDocuments({ revision: { $exists: true } }),
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

  // El índice de `revision.*` no se cae solo; syncIndexes crea el de `week.*`.
  await mongoose.connection.db.collection("checkinresponses").dropIndexes().catch(() => {});
  await CheckinResponse.syncIndexes();
  log("índices de checkinresponses regenerados");

  await mongoose.disconnect();
  log("done");
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
