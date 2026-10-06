// Migra los ejercicios al modelo muscular de dos niveles con énfasis
// (Exercise.muscles, ver components/exercises/muscle-catalog.js) y retira
// el vocabulario antiguo (muscleGroups1/2), que la app ya no lee.
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
// Idempotente: sin --force, un ejercicio que ya tiene `muscles` conserva los
// suyos (puede haberlos editado alguien después de migrar) y solo pierde
// los campos antiguos. Un ejercicio sin resolver se queda con `muscles: []`
// y sale en el informe. Antes de escribir se guarda copia de los campos
// originales en scripts/exports/.

const fs = require("fs");
const path = require("path");
const { normalizeMuscles, getNode, groupOf } = require("../../components/exercises/muscle-catalog");
const { normalizeLegacyText, fromLegacyMuscleGroups } = require("../lib/legacy-muscle-groups");
const { CURATED, CURATED_USER } = require("../data/exercise-muscles-curated");


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

// `force`: vuelve a calcular también los que ya tienen `muscles`. `verbose`:
// una línea por ejercicio.
async function migrateExerciseMuscles(db, { dryRun = false, force = false, verbose = false, log = console.log } = {}) {
  const isDryRun = dryRun;
  const isForce = force;
  const isVerbose = verbose;

  // Solo el nombre de la BD: la URI lleva credenciales.

  // En crudo: el schema ya no declara muscleGroups1/2.
  const exercises = await db.collection("exercises")
    .find({}, { projection: { name: 1, userId: 1, isCardio: 1, muscles: 1, muscleGroups1: 1, muscleGroups2: 1 } })
    .toArray();
  log(`${exercises.length} ejercicios en BD (${CURATED_BY_NAME.size} curados)\n`);

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

  const LEGACY_FIELDS = { muscleGroups1: "", muscleGroups2: "" };
  const hasLegacyFields = (exercise) => "muscleGroups1" in exercise || "muscleGroups2" in exercise;

  for (const exercise of exercises) {
    if (!isForce && Array.isArray(exercise.muscles)) {
      counts.skipped++;
      if (hasLegacyFields(exercise)) {
        operations.push({ updateOne: { filter: { _id: exercise._id }, update: { $unset: LEGACY_FIELDS } } });
      }
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
      backup.push({ _id: exercise._id, name: exercise.name, muscleGroups1: exercise.muscleGroups1, muscleGroups2: exercise.muscleGroups2 });
      operations.push({
        updateOne: { filter: { _id: exercise._id }, update: { $set: { muscles: [] }, $unset: LEGACY_FIELDS } },
      });
      continue;
    }

    const current = {
      muscles: exercise.muscles,
      muscleGroups1: exercise.muscleGroups1 || [],
      muscleGroups2: exercise.muscleGroups2 || [],
    };
    if (JSON.stringify(muscles) === JSON.stringify(exercise.muscles) && !hasLegacyFields(exercise)) {
      counts.unchanged++;
      continue;
    }

    if (isVerbose) {
      log(`[${source}] ${exercise.name}${exercise.userId ? " (propio)" : ""}`);
      log(`    ${describe(muscles)}`);
    }

    backup.push({ _id: exercise._id, name: exercise.name, ...current });
    operations.push({
      updateOne: { filter: { _id: exercise._id }, update: { $set: { muscles }, $unset: LEGACY_FIELDS } },
    });
  }

  const missingCurated = [...CURATED_BY_NAME.entries()]
    .filter(([key]) => !matchedCurated.has(key))
    .map(([, { name }]) => name);

  log("Resumen");
  log(`  Curados (catálogo global)      ${counts.curated}`);
  log(`  Propios revisados (PRO)        ${counts.curatedUser}`);
  log(`  Traducidos del modelo antiguo  ${counts.legacy}`);
  log(`  Cardio sin músculos            ${counts.cardio}`);
  log(`  Sin resolver (revisar a mano)  ${counts.unresolved}`);
  log(`  Ya migrados (sin --force)      ${counts.skipped}`);
  log(`  Sin cambios                    ${counts.unchanged}`);
  log(`  A escribir                     ${operations.length}`);

  if (unresolved.length) {
    log("\nSin resolver — asigna los músculos desde Biblioteca → Ejercicios:");
    for (const item of unresolved) {
      const legacyText = [...item.muscleGroups1, ...item.muscleGroups2].join(", ");
      log(`  - ${item.name}${item.global ? "" : " (propio)"}${legacyText ? ` [${legacyText}]` : ""}`);
    }
  }
  if (unknownLabels.size) {
    log("\nEtiquetas antiguas no reconocidas (se ignoran):");
    for (const [label, count] of unknownLabels) log(`  - "${label}" ×${count}`);
  }
  if (missingCurated.length && isForce) {
    log("\nCurados que no casan con ningún ejercicio global (¿renombrados?):");
    for (const name of missingCurated) log(`  - ${name}`);
  }

  const exportsDir = path.join(__dirname, "..", "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = Date.now();
  const reportPath = path.join(exportsDir, `exercise-muscles-report-${stamp}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ dryRun: isDryRun, counts, unresolved, missingCurated }, null, 2),
    "utf8",
  );
  log(`\nInforme: ${reportPath}`);

  if (!isDryRun && operations.length) {
    const backupPath = path.join(exportsDir, `exercise-muscles-backup-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
    log(`Copia de los campos originales: ${backupPath}`);

    const result = await db.collection("exercises").bulkWrite(operations, { ordered: false });
    log(`Actualizados: ${result.modifiedCount}`);
  }
  return { ...counts, toWrite: operations.length };
}

module.exports = { migrateExerciseMuscles };
