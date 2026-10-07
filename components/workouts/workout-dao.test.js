const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("./workout-schema");
const Table = require("../tables/table-schema");
const Exercise = require("../exercises/exercise-schema");
const workoutDao = require("./workout-dao");
const setDao = require("../sets/set-dao");

// Sesiones con ejercicios y series embebidos; microciclos embebidos en la
// tabla. Contra un Mongo efímero.
const db = useTestDb();

// Tabla de 2 microciclos x 2 filas. Cada sesión con un ejercicio y una serie.
async function seedTable() {
  const squat = await Exercise.create({ name: "Sentadilla" });
  const bench = await Exercise.create({ name: "Press banca" });
  const make = (name, exercise, extra = {}) =>
    Workout.create({
      name,
      exercises: [
        {
          exercise: exercise._id,
          sets: [{ reps: 5, doned: true, donedAt: new Date("2026-01-05"), cronometer: 40, drop: true, expectedRir: [-1] }],
        },
      ],
      ...extra,
    });
  const s1 = [await make("Pierna", squat, { date: new Date("2026-01-05") }), await make("Torso", bench)];
  const s2 = [await make("Pierna", squat), await make("Torso", bench)];
  const table = await Table.create({
    name: "Rutina",
    userId: db.oid(),
    splits: [
      { name: "S1", workouts: s1.map((w) => w._id) },
      { name: "S2", workouts: s2.map((w) => w._id) },
    ],
  });
  return { table, s1, s2, squat, bench };
}

const ids = (list) => list.map((item) => String(item._id || item));
const tableOf = async (id) => Table.findById(id).lean();

test("deleteWorkouts quita las sesiones de sus microciclos y las borra", async () => {
  await db.reset();
  const { table, s1, s2 } = await seedTable();

  const result = await workoutDao.deleteWorkouts([{ _id: s1[0]._id }, { _id: s2[1]._id }]);
  assert.equal(result.deletedCount, 2);

  const saved = await tableOf(table._id);
  assert.deepEqual(ids(saved.splits[0].workouts), ids([s1[1]]));
  assert.deepEqual(ids(saved.splits[1].workouts), ids([s2[0]]));
  assert.equal(await Workout.countDocuments({ _id: { $in: [s1[0]._id, s2[1]._id] } }), 0);
});

test("duplicateWorkoutRow copia la fila debajo en TODOS los microciclos, con la pauta y sin la ejecución", async () => {
  await db.reset();
  const { table, s1 } = await seedTable();

  const splits = await workoutDao.duplicateWorkoutRow(table._id, s1[0]._id, "Copia");
  assert.deepEqual(splits.map((split) => split.workouts.map((w) => w.name)), [
    ["Pierna", "Pierna Copia", "Torso"],
    ["Pierna", "Pierna Copia", "Torso"],
  ]);
  const copy = splits[0].workouts[1];
  assert.notEqual(String(copy._id), String(s1[0]._id));
  assert.equal(copy.date, undefined, "la fecha de la sesión hecha no se copia");
  assert.notEqual(String(copy.exercises[0]._id), String(s1[0].exercises[0]._id), "ejercicios con id nuevo");
  assert.equal(copy.exercises[0].exercise.name, "Sentadilla", "el Exercise llega poblado");
  const [set] = copy.exercises[0].sets;
  assert.equal(set.doned, undefined, "sin su ejecución");
  assert.equal(set.donedAt, undefined);
  assert.equal(set.cronometer, undefined);
  assert.equal(set.drop, true, "la pauta viaja igual: drop set");
  assert.deepEqual([...set.expectedRir], [-1], "y fallo");
  assert.equal(set.reps, 5);
});

test("reorderWorkoutRows aplica la misma permutación en todos los microciclos", async () => {
  await db.reset();
  const { table, s1, s2 } = await seedTable();

  await workoutDao.reorderWorkoutRows(table._id, [String(s1[1]._id), String(s1[0]._id)]);
  const saved = await tableOf(table._id);
  assert.deepEqual(ids(saved.splits[0].workouts), ids([s1[1], s1[0]]));
  assert.deepEqual(ids(saved.splits[1].workouts), ids([s2[1], s2[0]]));

  await assert.rejects(() => workoutDao.reorderWorkoutRows(table._id, [String(s1[0]._id)]), /Invalid workout order/);
});

test("addWorkoutsToSplits añade una sesión nueva al final de cada microciclo", async () => {
  await db.reset();
  const { table } = await seedTable();

  const splits = await workoutDao.addWorkoutsToSplits(table._id, { name: "Descanso", isPlannedRestDay: true, exercises: [] });
  assert.deepEqual(splits.map((split) => split.workouts.at(-1).name), ["Descanso", "Descanso"]);
  assert.notEqual(String(splits[0].workouts.at(-1)._id), String(splits[1].workouts.at(-1)._id));
});

test("modifyWorkout escribe el estado de la sesión; `exercises` solo reordena y nunca pisa las series", async () => {
  await db.reset();
  const squat = await Exercise.create({ name: "Sentadilla" });
  const workout = await Workout.create({
    name: "Pierna",
    exercises: [
      { exercise: squat._id, sets: [{ reps: 5 }] },
      { exercise: squat._id, sets: [{ reps: 6 }] },
    ],
  });
  const [a, b] = workout.exercises;
  // Otra pantalla marca una serie: la copia que manda modifyWorkout está desfasada.
  await setDao.updateSet({ _id: a.sets[0]._id, doned: true });

  const result = await workoutDao.modifyWorkout({
    _id: workout._id,
    readinessPre: 4,
    startedAt: new Date("2026-01-01T10:00:00Z"),
    trainerId: db.oid(),
    kind: "template",
    exercises: [
      { _id: b._id, sets: [{ _id: b.sets[0]._id, reps: 99 }] },
      { _id: a._id, sets: [{ _id: a.sets[0]._id, doned: false }] },
    ],
  });

  assert.equal(result.readinessPre, 4);
  assert.equal(result.trainerId, undefined, "una sesión no se convierte en plantilla por el cuerpo");
  assert.equal(result.kind, "session");
  assert.deepEqual(ids(result.exercises), ids([b, a]), "reordena");
  assert.equal(result.exercises[0].sets[0].reps, 6, "el contenido del cliente no pisa lo guardado");
  assert.equal(result.exercises[1].sets[0].doned, true, "la serie marcada sigue marcada");

  const removing = await workoutDao.modifyWorkout({ _id: workout._id, exercises: [{ _id: a._id }] });
  assert.equal(removing.exercises.length, 2, "una lista con ejercicios de menos no borra ninguno");
});

test("updateWorkout y addDataExerciseToWorkout añaden el ejercicio con sus series", async () => {
  await db.reset();
  const workout = await Workout.create({ name: "Pierna", exercises: [] });

  let result = await workoutDao.addDataExerciseToWorkout(workout._id, {
    notes: "Controla la bajada",
    sets: [{ _id: db.oid(), expectedReps: [10] }, { expectedReps: [8] }, String(db.oid())],
    exercise: { name: "Zancada propia", userId: db.oid() },
  });
  assert.equal(result.exercises.length, 1);
  assert.equal(result.exercises[0].exercise.name, "Zancada propia");
  assert.deepEqual(result.exercises[0].sets.map((set) => set.expectedReps), [[10], [8]]);
  assert.equal(result.exercises[0].notes, "Controla la bajada");

  const squat = await Exercise.create({ name: "Sentadilla" });
  result = await workoutDao.updateWorkout(
    { _id: workout._id, name: "Nombre desfasado", exercises: [] },
    { exercise: squat, notes: "x", sets: [{ expectedReps: [5] }] },
  );
  assert.equal(result.name, "Pierna", "el resto de la sesión no se reescribe");
  assert.deepEqual(result.exercises.map((exercise) => exercise.exercise.name), ["Zancada propia", "Sentadilla"]);
  assert.deepEqual(result.exercises[1].sets[0].expectedReps, [5]);
});

test("updateWorkoutsOrder, updateCustomExercises y updateWorkoutsName actúan sobre la misma fila", async () => {
  await db.reset();
  const squat = await Exercise.create({ name: "Sentadilla" });
  const bench = await Exercise.create({ name: "Press" });
  const row = await Promise.all(
    [0, 1].map(() => Workout.create({ name: "A", exercises: [{ exercise: squat._id }, { exercise: bench._id }] })),
  );
  const other = await Workout.create({ name: "B", exercises: [{ exercise: squat._id }] });
  const table = await Table.create({
    name: "Rutina",
    userId: db.oid(),
    splits: [{ workouts: [row[0]._id, other._id] }, { workouts: [row[1]._id] }],
  });

  await workoutDao.updateWorkoutsOrder(row[0]._id, table._id, [1, 0]);
  for (const workout of row) {
    const saved = await Workout.findById(workout._id).lean();
    assert.deepEqual(saved.exercises.map((e) => String(e.exercise)), [String(bench._id), String(squat._id)]);
  }

  const deadlift = await Exercise.create({ name: "Peso muerto" });
  const first = (await Workout.findById(row[0]._id).lean()).exercises[0];
  await workoutDao.updateCustomExercises(table._id, row[0]._id, first._id, deadlift._id);
  for (const workout of row) {
    const saved = await Workout.findById(workout._id).lean();
    assert.equal(String(saved.exercises[0].exercise), String(deadlift._id));
  }
  assert.equal(String((await Workout.findById(other._id).lean()).exercises[0].exercise), String(squat._id));

  await workoutDao.updateWorkoutsName(table._id, row[1]._id, "Empuje");
  assert.deepEqual((await Workout.find({ _id: { $in: row.map((w) => w._id) } }).lean()).map((w) => w.name), ["Empuje", "Empuje"]);
  assert.equal((await Workout.findById(other._id).lean()).name, "B");
});

test("borrar una tabla borra sus sesiones (los microciclos y las notas van dentro)", async () => {
  await db.reset();
  const { table, s1, s2 } = await seedTable();
  const keep = await Workout.create({ name: "De otra tabla" });

  await Table.deleteOne({ _id: table._id });
  assert.equal(await Workout.countDocuments({ _id: { $in: [...s1, ...s2].map((w) => w._id) } }), 0);
  assert.equal(await Workout.countDocuments({ _id: keep._id }), 1);
});
