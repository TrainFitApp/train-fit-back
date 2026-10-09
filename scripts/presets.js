// Contenido de fábrica sobre una base ya migrada (`npm run migrate`), en este
// orden: recetario verificado, rutinas públicas y dietas de fábrica. Cada uno
// es idempotente por nombre: lo que ya está no se toca.
//
//   npm run presets:dry-run                      informe, sin escribir
//   npm run presets                              pide teclear el nombre de la
//                                                base y crea lo que falta
//   npm run presets -- --owner=<email de admin>  quién firma las dietas (sin
//                                                él, el admin más antiguo)
//
// Más flags: --confirm=<base> (sin preguntar). Sale con error si algún preset
// no se pudo crear entero (falta un producto o un ejercicio en la base): el
// informe dice cuál. Los datos y el detalle de cada uno, en
// scripts/seed-verified-recipes.js, seed-public-routines.js y
// seed-verified-diets.js.

const path = require("path");
const mongoose = require("mongoose");
const { seedVerifiedRecipes } = require("./seed-verified-recipes");
const { seedPublicRoutines } = require("./seed-public-routines");
const { seedVerifiedDiets } = require("./seed-verified-diets");

const LOG_PREFIX = "[presets]";

const PRESETS = [
  { name: "recetas verificadas", run: seedVerifiedRecipes },
  { name: "rutinas públicas", run: seedPublicRoutines },
  { name: "dietas de fábrica", run: seedVerifiedDiets },
];

// Lo que se quedó sin crear por falta de algo en la base.
const incompleteStats = (stats) => Boolean(stats.blocked || stats.missingProducts || stats.missingExercises);

/**
 * Lanza cada preset en orden y devuelve `{ results, incomplete }`: las
 * estadísticas de cada uno y los nombres de los que no se crearon enteros.
 */
async function runPresets({ presets = PRESETS, dryRun = false, ownerEmail = null, log = () => {} } = {}) {
  const results = [];
  for (const preset of presets) {
    log(`${preset.name}${dryRun ? " (dry-run)" : ""}`);
    const stats = await preset.run({ dryRun, ownerEmail, log: (...args) => log(`  ${preset.name}:`, ...args) });
    results.push({ name: preset.name, stats });
  }
  return { results, incomplete: results.filter(({ stats }) => incompleteStats(stats)).map(({ name }) => name) };
}

module.exports = { PRESETS, runPresets };

if (require.main === module) {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const { SCRIPT_CONNECT_OPTIONS, buildMongoUri, redactMongoUri } = require("./_mongo-uri");
  const { confirmTarget, confirmArg } = require("./lib/confirm-target");
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const ownerEmail = args.find((arg) => arg.startsWith("--owner="))?.slice("--owner=".length) || null;
  const log = (...parts) => console.log(LOG_PREFIX, ...parts);

  (async () => {
    const uri = buildMongoUri();
    log(`connecting ${redactMongoUri(uri)}${dryRun ? " (dry-run)" : ""}`);
    await mongoose.connect(uri, SCRIPT_CONNECT_OPTIONS);
    if (!dryRun) {
      await confirmTarget(mongoose.connection.db, { uri: redactMongoUri(uri), action: "Crear el contenido de fábrica", confirm: confirmArg(args), log });
    }
    const { incomplete } = await runPresets({ dryRun, ownerEmail, log });
    if (dryRun) log("dry-run: no se ha escrito nada");
    if (incomplete.length) {
      log(`AVISO: sin crear entero: ${incomplete.join(", ")}`);
      process.exitCode = 1;
    }
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error(LOG_PREFIX, error.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
