const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Marca con `isIsometric: true` los ejercicios del catálogo global (sin
// userId) que se registran por tiempo de aguante y no por repeticiones. Con
// ese flag las estadísticas del ejercicio leen `timeSeconds` en vez de kg.
//
// Lista revisada sobre la copia de PRO (2026-09-30). Se casa por nombre
// normalizado, no por _id, para que sirva igual en PRO, PRE y local.
// Idempotente: solo escribe en los que aún no lo tienen a true.
//
// Uso:
//   npm run migrate:exercise-isometric:dry-run
//   npm run migrate:exercise-isometric

const ISOMETRIC_EXERCISES = [
  "Sostener mancuernas",
  "Aguantar colgado en barra",
  "Plancha",
  "Plancha lateral oblicuos",
  "Plancha lateral aductor",
];

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[migrate-exercise-isometric]";
const log = (...a) => console.log(LOG, ...a);

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  const Exercise = require("../components/exercises/exercise-schema");

  const catalog = await Exercise.find({ userId: null })
    .select("_id name isIsometric")
    .lean();
  log(`ejercicios del catálogo global: ${catalog.length}`);

  const byName = new Map();
  for (const exercise of catalog) {
    const key = normalizeName(exercise.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(exercise);
  }

  const toUpdate = [];
  const missing = [];
  for (const name of ISOMETRIC_EXERCISES) {
    const matches = byName.get(normalizeName(name)) || [];
    if (!matches.length) {
      missing.push(name);
      continue;
    }
    for (const exercise of matches) {
      if (exercise.isIsometric === true) {
        log(`  = ${exercise._id} ${exercise.name}: ya es isométrico`);
        continue;
      }
      log(`  + ${exercise._id} ${exercise.name}`);
      toUpdate.push(exercise._id);
    }
  }

  for (const name of missing) log(`  ! no encontrado: ${name}`);

  if (!DRY_RUN && toUpdate.length) {
    const result = await Exercise.updateMany(
      { _id: { $in: toUpdate } },
      { $set: { isIsometric: true } },
    );
    log(`actualizados: ${result.modifiedCount}`);
  } else {
    log(`por actualizar: ${toUpdate.length}${DRY_RUN ? " (dry-run, sin cambios)" : ""}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(LOG, error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
