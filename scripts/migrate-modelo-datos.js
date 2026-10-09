// Lleva cualquier base —PRO (rama main) o PRE (rama develop)— al modelo de
// datos de 2026-10 (docs/refactor-modelo-datos-estado.md). Un solo runner con
// los pasos en orden (scripts/migrations/NN-*.js); cada paso es idempotente y
// solo toca lo que todavía tiene la forma vieja. El último (99) rehace todos
// los índices. Después, el contenido de fábrica va aparte: `npm run presets`.
//
//   npm run migrate:dry-run          informe, sin escribir
//   npm run migrate                  compila los núcleos TS, pide teclear el
//                                    nombre de la base, aplica los pasos
//                                    pendientes y comprueba cada documento
//                                    contra su schema (scripts/verify-schemas.js)
//   npm run migrate -- --drop-old    además borra las colecciones viejas
//                                    (cuando todo está verificado)
//   npm run migrate -- --list        pasos y si están aplicados
//
// Más flags: --confirm=<base> (sin preguntar), --only=<paso>, --skip-verify.
// Sale con error si algún documento no pasa su schema al terminar.
//
// Los pasos aplicados se apuntan en `schemamigrations` y no se repiten; con
// --drop-old se vuelven a pasar (idempotentes) los que borran colecciones, y
// cada uno comprueba antes que no le queda nada pendiente. Los marcados como
// `always` se pasan siempre.
//
// --dry-run: cada paso informa de lo que haría sobre la base TAL COMO ESTÁ;
// como nada se escribe, los pasos que dependen de uno anterior informan de
// menos. Para un ensayo completo: restaurar una copia y aplicarlo sobre ella.
//
// Precondición: en PRO, las migraciones de la rama main ya aplicadas
// (migrate-tables-unify, migrate-dietday-dates…). Los emails sin normalizar
// los resuelve el paso 24.
// El preflight comprueba lo que se puede comprobar.

const path = require("path");
const mongoose = require("mongoose");

const { migrateNutritionModel } = require("./migrations/01-nutrition-model");
const { migrateDietDayUnique } = require("./migrations/02-dietday-unique-date");
const { migrateEmbedTraining } = require("./migrations/03-embed-training");
const { migrateEmbedNutrition } = require("./migrations/04-embed-nutrition");
const { migrateEmbedUserSettings } = require("./migrations/05-embed-user-settings");
const { migrateHiddenRecentFoods } = require("./migrations/06-hidden-recent-foods");
const { migrateExerciseMuscles } = require("./migrations/07-exercise-muscles");
const { migrateExerciseIsometric } = require("./migrations/08-exercise-isometric");
const { migrateDietPhases } = require("./migrations/09-diet-phases");
const { migrateUserFavorites } = require("./migrations/10-user-favorites");
const { migrateTrainerClientPairs } = require("./migrations/11-trainer-client-pairs");
const { migrateTrainerBillingSeats } = require("./migrations/12-trainer-billing-seats");
const { migrateTrainerPayments } = require("./migrations/13-trainer-payments");
const { migrateAnthropometrySides } = require("./migrations/14-anthropometry-sides");
const { markCheckinAnthropometry } = require("./migrations/15-mark-checkin-anthropometry");
const { migrateUserWeight } = require("./migrations/16-user-weight");
const { migratePhaseChains } = require("./migrations/17-phase-chains");
const { cleanup } = require("./migrations/18-cleanup");
const { migrateUserBirthDate } = require("./migrations/20-user-birth-date");
const { migrateIntakeForms } = require("./migrations/21-intake-forms");
const { migrateWorkoutRowBlocks } = require("./migrations/22-workout-row-blocks");
const { migrateRetiredFields } = require("./migrations/23-retired-fields");
const { migrateNormalizeEmails } = require("./migrations/24-normalize-emails");
const { migrateUndeclaredFields } = require("./migrations/25-undeclared-fields");
const { migrateOutOfRangeValues } = require("./migrations/26-out-of-range-values");
const { migrateExpectedWeight } = require("./migrations/27-expected-weight");
const { migrateCardioHabits } = require("./migrations/28-cardio-habits");
const { migrateIndexes } = require("./migrations/99-indexes");
const { verifySchemas } = require("./verify-schemas");

const LOG_PREFIX = "[migrate-modelo-datos]";
const RECORDS = "schemamigrations";

// El orden importa: cada paso cuenta con que los anteriores ya están.
const STEPS = [
  { id: "01-nutrition-model", run: migrateNutritionModel, dropsOld: true },
  { id: "02-dietday-unique-date", run: migrateDietDayUnique },
  { id: "03-embed-training", run: migrateEmbedTraining, dropsOld: true },
  { id: "04-embed-nutrition", run: migrateEmbedNutrition, dropsOld: true },
  { id: "05-embed-user-settings", run: migrateEmbedUserSettings, dropsOld: true },
  { id: "06-hidden-recent-foods", run: migrateHiddenRecentFoods, dropsOld: true },
  { id: "07-exercise-muscles", run: migrateExerciseMuscles },
  { id: "08-exercise-isometric", run: migrateExerciseIsometric },
  { id: "09-diet-phases", run: migrateDietPhases },
  { id: "10-user-favorites", run: migrateUserFavorites },
  { id: "11-trainer-client-pairs", run: migrateTrainerClientPairs, dropsOld: true },
  { id: "12-trainer-billing-seats", run: migrateTrainerBillingSeats },
  { id: "13-trainer-payments", run: migrateTrainerPayments },
  { id: "14-anthropometry-sides", run: migrateAnthropometrySides },
  { id: "15-mark-checkin-anthropometry", run: markCheckinAnthropometry },
  { id: "16-user-weight", run: migrateUserWeight },
  { id: "17-phase-chains", run: migratePhaseChains },
  { id: "18-cleanup", run: cleanup, always: true, dropsOld: true },
  { id: "20-user-birth-date", run: migrateUserBirthDate },
  { id: "21-intake-forms", run: migrateIntakeForms },
  { id: "22-workout-row-blocks", run: migrateWorkoutRowBlocks },
  { id: "23-retired-fields", run: migrateRetiredFields },
  { id: "24-normalize-emails", run: migrateNormalizeEmails },
  { id: "25-undeclared-fields", run: migrateUndeclaredFields },
  { id: "26-out-of-range-values", run: migrateOutOfRangeValues },
  { id: "27-expected-weight", run: migrateExpectedWeight },
  { id: "28-cardio-habits", run: migrateCardioHabits },
  // Siempre el último (99): un paso nuevo va antes de este, con el número
  // siguiente al anterior.
  { id: "99-indexes", run: migrateIndexes },
];

// Lo que la rama main ya debía haber dejado hecho en PRO.
async function preflight(db) {
  const collections = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  if (collections.has("owntables")) {
    throw new Error("Existe `owntables`: falta migrate-tables-unify (rama main). Aplícala antes.");
  }
}

async function runMigrations(db, { dryRun = false, dropOld = false, only = null, log = () => {}, now = new Date() } = {}) {
  await preflight(db);
  const records = db.collection(RECORDS);
  const applied = new Map((await records.find({}).toArray()).map((record) => [record._id, record]));
  const results = [];

  for (const step of STEPS) {
    if (only && step.id !== only) continue;
    const done = applied.has(step.id);
    const rerunToDrop = done && dropOld && step.dropsOld;
    if (done && !step.always && !rerunToDrop) continue;

    log(`${step.id}${dryRun ? " (dry-run)" : ""}${rerunToDrop ? " (--drop-old)" : ""}`);
    const stats = await step.run(db, {
      dryRun,
      dropOld: dropOld && Boolean(step.dropsOld),
      log: (...args) => log(`  ${step.id}:`, ...args),
      now,
    });
    log(`  ${step.id}: ${JSON.stringify(stats)}`);
    results.push({ id: step.id, stats });

    if (!dryRun) {
      await records.updateOne(
        { _id: step.id },
        {
          $set: { lastRunAt: new Date(), stats, ...(dropOld && step.dropsOld ? { droppedOldAt: new Date() } : {}) },
          $setOnInsert: { appliedAt: new Date() },
        },
        { upsert: true },
      );
    }
  }
  return results;
}

async function listSteps(db) {
  const applied = new Map((await db.collection(RECORDS).find({}).toArray()).map((record) => [record._id, record]));
  return STEPS.map((step) => ({
    id: step.id,
    appliedAt: applied.get(step.id)?.appliedAt || null,
    droppedOldAt: applied.get(step.id)?.droppedOldAt || null,
  }));
}

/**
 * Los pasos pendientes y, si se ha escrito algo, la comprobación de cada
 * documento contra su schema. Devuelve `{ results, verification }`
 * (`verification` es null en --dry-run, con --only o con `verify: false`).
 */
async function migrateAndVerify(db, { dryRun = false, dropOld = false, only = null, verify = true, log = () => {} } = {}) {
  const results = await runMigrations(db, { dryRun, dropOld, only, log });
  const verification = !dryRun && !only && verify ? await verifySchemas(db, { log: (...args) => log("  verify-schemas:", ...args) }) : null;
  return { results, verification };
}

module.exports = { STEPS, runMigrations, migrateAndVerify, listSteps };

if (require.main === module) {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const { SCRIPT_CONNECT_OPTIONS, buildMongoUri, redactMongoUri } = require("./_mongo-uri");
  const { confirmTarget, confirmArg } = require("./lib/confirm-target");
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const onlyArg = args.find((arg) => arg.startsWith("--only="));
  const log = (...parts) => console.log(LOG_PREFIX, ...parts);

  (async () => {
    const uri = buildMongoUri();
    log(`connecting ${redactMongoUri(uri)}`);
    await mongoose.connect(uri, SCRIPT_CONNECT_OPTIONS);
    const db = mongoose.connection.db;
    if (flag("--list")) {
      for (const step of await listSteps(db)) {
        log(`${step.id}  ${step.appliedAt ? `aplicado ${step.appliedAt.toISOString()}` : "pendiente"}`);
      }
    } else {
      const dryRun = flag("--dry-run");
      if (!dryRun) {
        await confirmTarget(db, { uri: redactMongoUri(uri), action: flag("--drop-old") ? "Migrar y borrar lo viejo" : "Migrar", confirm: confirmArg(args), log });
      }
      const { verification } = await migrateAndVerify(db, {
        dryRun,
        dropOld: flag("--drop-old"),
        only: onlyArg ? onlyArg.slice("--only=".length) : null,
        verify: !flag("--skip-verify"),
        log,
      });
      if (dryRun) log("dry-run: no se ha escrito nada");
      if (verification?.invalid) process.exitCode = 1;
    }
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error(LOG_PREFIX, error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
