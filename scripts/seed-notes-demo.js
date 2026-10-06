const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

/**
 * Demo de notas de entrenamiento (2026-09-27): deja la rutina asignada de
 * u2@u (entrenador t2@t) con todos los casos de nota del entrenador frente a
 * nota del cliente, para verlos en la app del cliente y en el Planner.
 *
 * Borra TODAS las notas de esa rutina (Workout.notes/clientNotes,
 * las notas de sus ejercicios y sus notas ancladas) y siembra los
 * casos. Antes guarda una copia en un JSON (ruta en la salida) para poder
 * volver atrás con --restore. Solo toca la rutina de u2@u asignada por t2@t:
 * si no la encuentra así, no escribe nada.
 *
 * Los mismos textos en los 4 microciclos (salvo las notas del cliente, que
 * llevan el número de microciclo para ver la "de la sesión anterior"):
 *   Día 1  workout: nota del entrenador + nota del cliente
 *          E1: nota del entrenador + anclada por el entrenador + nota del cliente
 *          E2: solo nota del entrenador
 *          E3: solo anclada por el entrenador
 *          E4: nota del cliente + anclada por el cliente
 *   Día 2  workout: solo nota del cliente
 *          E1: nota del entrenador larga
 *          E2: anclada antigua (sin authorRole)
 *   Día 3  sin notas
 *
 * USO
 *   node scripts/seed-notes-demo.js --dry-run         -> muestra el plan
 *   node scripts/seed-notes-demo.js                   -> copia + borra + siembra
 *   node scripts/seed-notes-demo.js --restore <json>  -> deja lo que había
 */

const CLIENT_EMAIL = "u2@u";
const TRAINER_EMAIL = "t2@t";

function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-notes-demo:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const WORKOUT_NOTES = {
  0: {
    notes:
      "Sesión de fuerza: descansa 2-3 min en los básicos y apunta el RIR real de cada serie.\nSi llegas con agujetas fuertes, baja un 10 % la carga y avísame.",
    clientNotes: (micro) => `M${micro}: dormí poco, igual bajo algo de peso hoy.`,
  },
  1: {
    clientNotes: (micro) => `M${micro}: gimnasio lleno, cambié el orden de los accesorios.`,
  },
};

const EXERCISE_NOTES = {
  "0:0": {
    notes: "Escápulas retraídas y codos a 45°. Pausa de 1 s en el pecho.",
    clientNotes: (micro) => `M${micro}: el hombro derecho tiró en la última serie.`,
  },
  "0:1": { notes: "Tira con el codo, no con el bíceps." },
  "0:3": { clientNotes: (micro) => `M${micro}: agarre cómodo con la barra Z.` },
  "1:0": {
    notes:
      "Semana de descarga: RIR 3, sin buscar el fallo.\n\n" +
      "Calienta con 2 series de aproximación (50 % y 70 %). Baja controlando 3 segundos, " +
      "rompe el paralelo solo si la espalda baja no se redondea y sube empujando el suelo con todo el pie. " +
      "Si la rodilla derecha molesta, reduce el recorrido y apúntalo en tu nota para que lo revisemos " +
      "en el próximo check-in. Nada de rebotar abajo.",
  },
};

const PINNED = [
  { workoutIndex: 0, exerciseIndex: 0, authorRole: "trainer", notes: "Todo el bloque: el banca siempre con pies apoyados y glúteo en el banco." },
  { workoutIndex: 0, exerciseIndex: 2, authorRole: "trainer", notes: "Mancuernas: sube hasta la línea de las orejas, sin bloquear codos." },
  { workoutIndex: 0, exerciseIndex: 3, authorRole: "client", notes: "Uso la barra Z de la sala 2, la otra está doblada." },
  { workoutIndex: 1, exerciseIndex: 1, authorRole: null, notes: "Nota antigua: mantener la barra pegada a las piernas." },
];

async function loadTarget(db) {
  const [client, trainer] = await Promise.all([
    db.collection("users").findOne({ email: CLIENT_EMAIL }, { projection: { _id: 1 } }),
    db.collection("users").findOne({ email: TRAINER_EMAIL }, { projection: { _id: 1 } }),
  ]);
  if (!client || !trainer) throw new Error(`No existen ${CLIENT_EMAIL} y ${TRAINER_EMAIL}`);
  const tables = await db
    .collection("tables")
    .find({ userId: client._id, assignedByTrainerId: trainer._id })
    .toArray();
  if (tables.length !== 1) throw new Error(`Esperaba 1 rutina de ${CLIENT_EMAIL} asignada por ${TRAINER_EMAIL}, hay ${tables.length}`);
  const table = tables[0];
  // Microciclos y notas ancladas van dentro de la tabla; ejercicios dentro de
  // su sesión (modelo embebido, 2026-10).
  const orderedSplits = table.splits || [];
  const workoutIds = orderedSplits.flatMap((split) => split.workouts || []);
  const workouts = await db.collection("workouts").find({ _id: { $in: workoutIds } }).toArray();
  const workoutsById = new Map(workouts.map((workout) => [String(workout._id), workout]));
  const customExercises = workouts.flatMap((workout) => workout.exercises || []);
  const pinned = table.pinnedNotes || [];
  return { table, orderedSplits, workoutsById, customExercises, pinned };
}

function buildPlan({ table, orderedSplits, workoutsById }) {
  const workoutSets = [];
  const exerciseSets = [];
  orderedSplits.forEach((split, splitIndex) => {
    const micro = splitIndex + 1;
    split.workouts.forEach((workoutId, workoutIndex) => {
      const workout = workoutsById.get(String(workoutId));
      if (!workout) return;
      const workoutCase = WORKOUT_NOTES[workoutIndex];
      if (workoutCase) {
        const $set = {};
        if (workoutCase.notes) $set.notes = workoutCase.notes;
        if (workoutCase.clientNotes) $set.clientNotes = workoutCase.clientNotes(micro);
        workoutSets.push({ _id: workout._id, label: `M${micro} D${workoutIndex + 1}`, $set });
      }
      (workout.exercises || []).forEach((customExercise, exerciseIndex) => {
        const exerciseCase = EXERCISE_NOTES[`${workoutIndex}:${exerciseIndex}`];
        if (!exerciseCase) return;
        const $set = {};
        if (exerciseCase.notes) $set.notes = exerciseCase.notes;
        if (exerciseCase.clientNotes) $set.clientNotes = exerciseCase.clientNotes(micro);
        exerciseSets.push({ _id: customExercise._id, label: `M${micro} D${workoutIndex + 1} E${exerciseIndex + 1}`, $set });
      });
    });
  });
  const now = new Date();
  const pinnedDocs = PINNED.map((pin) => ({
    _id: oid(`pinned:${pin.workoutIndex}:${pin.exerciseIndex}`),
    workoutIndex: pin.workoutIndex,
    exerciseIndex: pin.exerciseIndex,
    notes: pin.notes,
    ...(pin.authorRole ? { authorRole: pin.authorRole } : {}),
    createdAt: now,
    updatedAt: now,
  }));
  return { workoutSets, exerciseSets, pinnedDocs };
}

function backupOf({ table, workoutsById, customExercises, pinned }) {
  return {
    tableId: String(table._id),
    workouts: [...workoutsById.values()].map((workout) => ({ _id: String(workout._id), notes: workout.notes, clientNotes: workout.clientNotes })),
    customExercises: customExercises.map((customExercise) => ({
      _id: String(customExercise._id),
      notes: customExercise.notes,
      clientNotes: customExercise.clientNotes,
    })),
    pinned,
  };
}

// $set de lo que había y $unset de lo que no, campo a campo (`prefix` para
// los ejercicios, que van dentro de su sesión: "exercises.$.").
function restoreUpdate(doc, prefix = "") {
  const $set = {};
  const $unset = {};
  for (const field of ["notes", "clientNotes"]) {
    if (typeof doc[field] === "string" && doc[field] !== "") $set[`${prefix}${field}`] = doc[field];
    else $unset[`${prefix}${field}`] = 1;
  }
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

async function restore(db, file) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const tableId = new mongoose.Types.ObjectId(backup.tableId);
  const { table } = await loadTarget(db);
  if (!table._id.equals(tableId)) throw new Error("La copia no es de la rutina de u2@u");
  for (const workout of backup.workouts) {
    await db.collection("workouts").updateOne({ _id: new mongoose.Types.ObjectId(workout._id) }, restoreUpdate(workout));
  }
  for (const customExercise of backup.customExercises) {
    await db
      .collection("workouts")
      .updateOne({ "exercises._id": new mongoose.Types.ObjectId(customExercise._id) }, restoreUpdate(customExercise, "exercises.$."));
  }
  await db.collection("tables").updateOne(
    { _id: tableId },
    {
      $set: {
        pinnedNotes: backup.pinned.map((pin) => ({
          ...pin,
          _id: new mongoose.Types.ObjectId(pin._id),
          createdAt: pin.createdAt ? new Date(pin.createdAt) : undefined,
          updatedAt: pin.updatedAt ? new Date(pin.updatedAt) : undefined,
        })),
      },
    },
  );
  console.log(`Restaurado desde ${file}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const restoreIndex = args.indexOf("--restore");

  const uri = buildMongoUri();
  console.log(`BD: ${redactMongoUri(uri)}${dryRun ? "  (dry-run)" : ""}`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  try {
    if (restoreIndex >= 0) {
      const file = args[restoreIndex + 1];
      if (!file) throw new Error("--restore necesita la ruta del JSON");
      if (dryRun) {
        console.log(`Restauraría desde ${file}`);
        return;
      }
      await restore(db, file);
      return;
    }

    const target = await loadTarget(db);
    const plan = buildPlan(target);
    const workoutIds = [...target.workoutsById.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const customExerciseIds = target.customExercises.map((customExercise) => customExercise._id);

    console.log(`Rutina "${target.table.name}" (${target.table._id})`);
    console.log(`Borrar: notas de ${workoutIds.length} workouts, ${customExerciseIds.length} ejercicios y ${target.pinned.length} ancladas`);
    plan.workoutSets.forEach((item) => console.log(`  workout  ${item.label}: ${Object.keys(item.$set).join(", ")}`));
    plan.exerciseSets.forEach((item) => console.log(`  ejercicio ${item.label}: ${Object.keys(item.$set).join(", ")}`));
    plan.pinnedDocs.forEach((pin) => console.log(`  anclada  D${pin.workoutIndex + 1} E${pin.exerciseIndex + 1}: ${pin.authorRole || "antigua (sin autor)"}`));
    if (dryRun) return;

    const backupFile = path.join(os.tmpdir(), `seed-notes-demo-backup-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupOf(target), null, 2));
    console.log(`Copia de lo anterior: ${backupFile}`);

    await db.collection("workouts").updateMany({ _id: { $in: workoutIds } }, { $unset: { notes: 1, clientNotes: 1 } });
    await db
      .collection("workouts")
      .updateMany({ _id: { $in: workoutIds } }, { $unset: { "exercises.$[].notes": 1, "exercises.$[].clientNotes": 1 } });

    for (const item of plan.workoutSets) await db.collection("workouts").updateOne({ _id: item._id }, { $set: item.$set });
    for (const item of plan.exerciseSets) {
      const $set = Object.fromEntries(Object.entries(item.$set).map(([field, value]) => [`exercises.$.${field}`, value]));
      await db.collection("workouts").updateOne({ "exercises._id": item._id }, { $set });
    }
    await db.collection("tables").updateOne({ _id: target.table._id }, { $set: { pinnedNotes: plan.pinnedDocs } });
    console.log("Hecho.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
