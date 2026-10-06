// Migra los ejercicios al modelo muscular de dos niveles con énfasis
// (Exercise.muscles, ver components/exercises/muscle-catalog.js).
//
//   npm run migrate:exercise-muscles:dry-run   → informe sin tocar nada
//   npm run migrate:exercise-muscles           → aplica los cambios
//
// Flags: --dry-run, --force (vuelve a calcular también los que ya tienen
// `muscles`), --verbose (imprime cada ejercicio).
//
// De dónde sale cada ejercicio, por orden:
//   1. Catálogo global (sin userId) → dato curado de
//      scripts/data/exercise-muscles-curated.js, casado por nombre.
//   2. Ejercicio propio con muscleGroups1/2 → se traducen: el criterio del
//      entrenador que lo creó se respeta, solo se normaliza.
//   3. Ejercicio propio sin datos pero con el nombre de uno del catálogo →
//      dato curado.
//   4. Ejercicio propio sin datos con nombre revisado en la copia de PRO
//      (CURATED_USER) → ese dato.
//   5. Lo demás queda sin `muscles` y sale en el informe para revisar.
//
// Idempotente: sin --force, un ejercicio que ya tiene `muscles` no se toca
// (puede haberlo editado alguien después de migrar). Antes de escribir se
// guarda copia de los campos originales en scripts/exports/.

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");
const Exercise = require("../components/exercises/exercise-schema");
const {
  normalizeMuscles,
  toLegacyMuscleGroups,
  fromLegacyMuscleGroups,
  normalizeLegacyText,
  getNode,
  groupOf,
} = require("../components/exercises/muscle-catalog");
const { CURATED, CURATED_USER } = require("./data/exercise-muscles-curated");

const isDryRun = process.argv.includes("--dry-run");
const isForce = process.argv.includes("--force");
const isVerbose = process.argv.includes("--verbose");

function byNormalizedName(map) {
  return new Map(
    Object.entries(map).map(([name, muscles]) => [
      normalizeLegacyText(name),
      { name, muscles: normalizeMuscles(muscles) },
    ]),
  );
}

const CURATED_BY_NAME = byNormalizedName(CURATED);
const CURATED_USER_BY_NAME = byNormalizedName(CURATED_USER);

function hasLegacyData(exercise) {
  return [...(exercise.muscleGroups1 || []), ...(exercise.muscleGroups2 || [])].some(
    (value) => String(value || "").trim(),
  );
}

// "Cabeza larga" suelta no dice de qué músculo es.
function fullLabel(muscle) {
  const node = getNode(muscle);
  const group = groupOf(muscle);
  if (node.isGroup || node.label.startsWith(group.label)) return node.label;
  return `${group.label} (${node.label.toLowerCase()})`;
}

function describe(muscles) {
  if (!muscles.length) return "(sin músculos)";
  const byRole = { primary: [], secondary: [], stabilizer: [] };
  for (const { muscle, role } of muscles) byRole[role].push(fullLabel(muscle));
  return [
    byRole.primary.length && `P: ${byRole.primary.join(", ")}`,
    byRole.secondary.length && `S: ${byRole.secondary.join(", ")}`,
    byRole.stabilizer.length && `E: ${byRole.stabilizer.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Decide los músculos de un ejercicio y de dónde salen. */
function resolve(exercise) {
  const curated = CURATED_BY_NAME.get(normalizeLegacyText(exercise.name));
  const isGlobal = !exercise.userId;

  if (isGlobal && curated) {
    return { source: "curated", muscles: curated.muscles };
  }

  if (hasLegacyData(exercise)) {
    const { muscles, unknown } = fromLegacyMuscleGroups(
      exercise.muscleGroups1,
      exercise.muscleGroups2,
    );
    if (muscles.length) return { source: "legacy", muscles, unknown };
    if (curated) return { source: "curated", muscles: curated.muscles };
    return { source: "unresolved", muscles: [], unknown };
  }

  if (curated) return { source: "curated", muscles: curated.muscles };
  const curatedUser = CURATED_USER_BY_NAME.get(normalizeLegacyText(exercise.name));
  if (curatedUser) return { source: "curatedUser", muscles: curatedUser.muscles };
  if (exercise.isCardio) return { source: "cardio", muscles: [] };
  return { source: "unresolved", muscles: [] };
}

async function migrate() {
  if (isDryRun) console.log("DRY RUN — no se escribe nada\n");

  await mongoose.connect(buildMongoUri());
  // Solo el nombre de la BD: la URI lleva credenciales.
  console.log(`Conectado a la base de datos "${mongoose.connection.name}"`);

  const exercises = await Exercise.find(
    {},
    "name userId isCardio muscles muscleGroups1 muscleGroups2",
  ).lean();
  console.log(`${exercises.length} ejercicios en BD (${CURATED_BY_NAME.size} curados)\n`);

  const counts = {
    curated: 0,
    curatedUser: 0,
    legacy: 0,
    cardio: 0,
    unresolved: 0,
    skipped: 0,
    unchanged: 0,
  };
  const unresolved = [];
  const unknownLabels = new Map();
  const matchedCurated = new Set();
  const operations = [];
  const backup = [];

  for (const exercise of exercises) {
    if (!isForce && Array.isArray(exercise.muscles)) {
      counts.skipped++;
      continue;
    }

    const { source, muscles, unknown = [] } = resolve(exercise);
    counts[source]++;
    if (source === "curated") matchedCurated.add(normalizeLegacyText(exercise.name));
    for (const label of unknown) unknownLabels.set(label, (unknownLabels.get(label) || 0) + 1);

    if (source === "unresolved") {
      unresolved.push({
        _id: String(exercise._id),
        name: exercise.name,
        global: !exercise.userId,
        muscleGroups1: exercise.muscleGroups1 || [],
        muscleGroups2: exercise.muscleGroups2 || [],
      });
      continue;
    }

    const legacy = toLegacyMuscleGroups(muscles);
    const next = { muscles, ...legacy };
    const current = {
      muscles: exercise.muscles,
      muscleGroups1: exercise.muscleGroups1 || [],
      muscleGroups2: exercise.muscleGroups2 || [],
    };
    if (JSON.stringify(next) === JSON.stringify(current)) {
      counts.unchanged++;
      continue;
    }

    if (isVerbose) {
      console.log(`[${source}] ${exercise.name}${exercise.userId ? " (propio)" : ""}`);
      console.log(`    ${describe(muscles)}`);
    }

    backup.push({ _id: exercise._id, name: exercise.name, ...current });
    operations.push({
      updateOne: { filter: { _id: exercise._id }, update: { $set: next } },
    });
  }

  const missingCurated = [...CURATED_BY_NAME.entries()]
    .filter(([key]) => !matchedCurated.has(key))
    .map(([, { name }]) => name);

  console.log("Resumen");
  console.log(`  Curados (catálogo global)      ${counts.curated}`);
  console.log(`  Propios revisados (PRO)        ${counts.curatedUser}`);
  console.log(`  Traducidos del modelo antiguo  ${counts.legacy}`);
  console.log(`  Cardio sin músculos            ${counts.cardio}`);
  console.log(`  Sin resolver (revisar a mano)  ${counts.unresolved}`);
  console.log(`  Ya migrados (sin --force)      ${counts.skipped}`);
  console.log(`  Sin cambios                    ${counts.unchanged}`);
  console.log(`  A escribir                     ${operations.length}`);

  if (unresolved.length) {
    console.log("\nSin resolver — asigna los músculos desde Biblioteca → Ejercicios:");
    for (const item of unresolved) {
      const legacyText = [...item.muscleGroups1, ...item.muscleGroups2].join(", ");
      console.log(`  - ${item.name}${item.global ? "" : " (propio)"}${legacyText ? ` [${legacyText}]` : ""}`);
    }
  }
  if (unknownLabels.size) {
    console.log("\nEtiquetas antiguas no reconocidas (se ignoran):");
    for (const [label, count] of unknownLabels) console.log(`  - "${label}" ×${count}`);
  }
  if (missingCurated.length && isForce) {
    console.log("\nCurados que no casan con ningún ejercicio global (¿renombrados?):");
    for (const name of missingCurated) console.log(`  - ${name}`);
  }

  const exportsDir = path.join(__dirname, "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = Date.now();
  const reportPath = path.join(exportsDir, `exercise-muscles-report-${stamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ dryRun: isDryRun, counts, unresolved, missingCurated }, null, 2),
    "utf8",
  );
  console.log(`\nInforme: ${reportPath}`);

  if (!isDryRun && operations.length) {
    const backupPath = path.join(exportsDir, `exercise-muscles-backup-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
    console.log(`Copia de los campos originales: ${backupPath}`);

    const result = await Exercise.bulkWrite(operations, { ordered: false });
    console.log(`Actualizados: ${result.modifiedCount}`);
  }

  await mongoose.disconnect();
}

migrate().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
