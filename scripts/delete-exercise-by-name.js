const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const Exercise = require("../components/exercises/exercise-schema");
const CustomExercise = require("../components/customExercises/custom-exercise-schema");
const Workout = require("../components/workouts/workout-schema");
const Split = require("../components/splits/split-schema");
const Table = require("../components/tables/table-schema");
const ExerciseScore = require("../components/exerciseScores/exercise-score-schema");
const User = require("../components/users/schema");
const SetModel = require("../components/sets/set-schema");
const {
  withPinnedNotesSync,
} = require("../components/pinnedExerciseNotes/pinned-exercise-note-anchor-sync");

// Borra un ejercicio del catálogo por nombre, en la BBDD del `.env` y en PRO
// (`MONGODB_URI_PRO`), junto con todo lo que cuelga de él:
//   - Exercise.deleteOne dispara el hook de exercise-schema.js: borra sus
//     CustomExercise (y los Set de estos), los saca de Workout.exercises
//     —también de las plantillas del entrenador— y de User.archivedExercises.
//   - ExerciseScore (puntuación del entrenador): el hook no la limpia.
//   - Notas fijadas: se guardan por posición, así que quitar un ejercicio
//     mueve las de debajo. Se reubican con withPinnedNotesSync, como hace la app.
//
// Sin --apply solo lee y muestra el plan. Con --apply pide confirmación y
// guarda antes una copia de lo que borra en scripts/backups/.
//
// Uso: node scripts/delete-exercise-by-name.js "Curl 21" [--apply] [--yes]
//        [--sin-pro] [--incluir-propios]

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const name = args.find((arg) => !arg.startsWith("--"))?.trim();

const APPLY = flags.has("--apply");
const ASSUME_YES = flags.has("--yes");
const SKIP_PRO = flags.has("--sin-pro");
const INCLUDE_OWNED = flags.has("--incluir-propios");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ids = (docs) => docs.map((doc) => doc._id);

function usage(message) {
  console.error(message);
  console.error(
    'Uso: node scripts/delete-exercise-by-name.js "Nombre" [--apply] [--yes] [--sin-pro] [--incluir-propios]',
  );
  process.exit(1);
}

// host + base de datos, sin credenciales: sirve para detectar que PRO y el
// `.env` apuntan a la misma BBDD y no borrar dos veces.
function dbKey(uri) {
  try {
    const { host, pathname } = new URL(uri);
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return uri;
  }
}

function resolveTargets() {
  const targets = [{ label: "BBDD (.env)", uri: buildMongoUri() }];
  const proUri = process.env.MONGODB_URI_PRO;

  if (SKIP_PRO) return targets;
  if (!proUri) {
    usage(
      "Falta MONGODB_URI_PRO (ponla en .env o en el entorno). Si solo quieres la BBDD del .env, usa --sin-pro.",
    );
  }
  if (dbKey(proUri) === dbKey(targets[0].uri)) {
    console.log("MONGODB_URI_PRO apunta a la misma BBDD que el .env: se procesa una sola vez.");
    return targets;
  }
  targets.push({ label: "PRO", uri: proUri });
  return targets;
}

async function buildPlan() {
  const matches = await Exercise.find({
    name: new RegExp(`^\\s*${escapeRegex(name)}\\s*$`, "i"),
  }).lean();
  const isOwned = (exercise) => Boolean(exercise.userId);
  const exercises = INCLUDE_OWNED ? matches : matches.filter((e) => !isOwned(e));
  const skippedOwned = INCLUDE_OWNED ? [] : matches.filter(isOwned);

  const similar = await Exercise.find(
    { name: new RegExp(escapeRegex(name), "i"), _id: { $nin: ids(matches) } },
    "name userId",
  ).lean();

  const exerciseIds = ids(exercises);
  const customExercises = await CustomExercise.find({ exercise: { $in: exerciseIds } }).lean();
  const customExerciseIds = ids(customExercises);
  const setIds = customExercises.flatMap((ce) => ce.sets || []);

  // Workout excluye las plantillas (trainerId) en toda query sin trainerId
  // propio: `workouts` son solo los reales y `templates` se piden aparte.
  const inWorkouts = { exercises: { $in: customExerciseIds } };
  const [workouts, templates, archivedBy, scores, sets] = await Promise.all([
    Workout.find(inWorkouts, "_id").lean(),
    Workout.find({ ...inWorkouts, trainerId: { $ne: null } }, "_id").lean(),
    User.find({ archivedExercises: { $in: exerciseIds } }, "_id").lean(),
    ExerciseScore.find({ exerciseId: { $in: exerciseIds } }).lean(),
    SetModel.find({ _id: { $in: setIds } }).lean(),
  ]);

  const splits = await Split.find({ workouts: { $in: ids(workouts) } }, "_id").lean();
  const tables = await Table.find({ splits: { $in: ids(splits) } }, "_id").lean();

  return {
    exercises,
    skippedOwned,
    similar,
    customExercises,
    sets,
    workouts,
    templates,
    archivedBy,
    scores,
    tableIds: ids(tables),
  };
}

function printPlan(plan) {
  const describe = (e) => `${e.name} (${e._id}${e.userId ? `, propio de ${e.userId}` : ", catálogo"})`;

  plan.exercises.forEach((e) => console.log(`  ejercicio      ${describe(e)}`));
  console.log(`  customExercise ${plan.customExercises.length}`);
  console.log(`  sets           ${plan.sets.length}`);
  console.log(`  workouts       ${plan.workouts.length} de clientes + ${plan.templates.length} plantillas de entrenador`);
  console.log(`  tablas         ${plan.tableIds.length} (se reubican sus notas fijadas)`);
  console.log(`  favoritos      ${plan.archivedBy.length} usuarios`);
  console.log(`  puntuaciones   ${plan.scores.length}`);
  plan.skippedOwned.forEach((e) =>
    console.log(`  OMITIDO (propio, usa --incluir-propios): ${describe(e)}`),
  );
  plan.similar.forEach((e) => console.log(`  parecido, NO se borra: ${e.name} (${e._id})`));
}

function writeBackup(label, plan) {
  const dir = path.join(__dirname, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = path.join(dir, `delete-${slug}-${label.replace(/\W+/g, "")}-${Date.now()}.json`);
  const { skippedOwned, similar, ...backup } = plan;
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), "utf8");
  return file;
}

async function applyPlan(plan) {
  const exerciseIds = ids(plan.exercises);

  await withPinnedNotesSync(plan.tableIds, async () => {
    await ExerciseScore.deleteMany({ exerciseId: { $in: exerciseIds } });
    // Uno a uno: el hook de cascada solo salta en deleteOne, no en deleteMany.
    for (const id of exerciseIds) await Exercise.deleteOne({ _id: id });
  });

  const [leftExercises, leftCustom] = await Promise.all([
    Exercise.countDocuments({ _id: { $in: exerciseIds } }),
    CustomExercise.countDocuments({ exercise: { $in: exerciseIds } }),
  ]);
  if (leftExercises || leftCustom) {
    throw new Error(
      `Quedan restos tras borrar: ${leftExercises} ejercicios, ${leftCustom} customExercises.`,
    );
  }
}

async function confirm(question) {
  if (ASSUME_YES) return true;
  if (!process.stdin.isTTY) {
    console.error("Sin terminal interactiva: usa --yes para confirmar.");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim() === "BORRAR";
}

async function withConnection(target, work) {
  console.log(`\n== ${target.label}: ${redactMongoUri(target.uri)}`);
  await mongoose.connect(target.uri);
  try {
    return await work();
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  if (!name) usage("Falta el nombre del ejercicio.");

  const targets = resolveTargets();
  console.log(`${APPLY ? "APLICAR" : "DRY RUN (no se borra nada)"} — ejercicio "${name}"`);

  const plans = [];
  for (const target of targets) {
    const plan = await withConnection(target, buildPlan);
    printPlan(plan);
    plans.push({ target, plan });
  }

  const pending = plans.filter(({ plan }) => plan.exercises.length > 0);
  if (!APPLY) {
    console.log("\nDry run terminado. Añade --apply para borrar.");
    return;
  }
  if (pending.length === 0) {
    console.log("\nNada que borrar.");
    return;
  }

  const labels = pending.map(({ target }) => target.label).join(" y ");
  if (!(await confirm(`\nSe borrará "${name}" en ${labels}. Escribe BORRAR para continuar: `))) {
    console.log("Cancelado. No se ha borrado nada.");
    return;
  }

  for (const { target } of pending) {
    await withConnection(target, async () => {
      // Se recalcula: entre el dry run y la confirmación la BBDD puede haber cambiado.
      const plan = await buildPlan();
      if (plan.exercises.length === 0) return console.log("  ya no queda nada que borrar");
      console.log(`  copia de seguridad: ${writeBackup(target.label, plan)}`);
      await applyPlan(plan);
      console.log(
        `  borrado: ${plan.exercises.length} ejercicio(s), ${plan.customExercises.length} customExercise(s), ${plan.sets.length} set(s), ${plan.scores.length} puntuación(es).`,
      );
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
