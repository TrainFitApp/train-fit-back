const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../workouts/workout-schema");
const Table = require("../tables/table-schema");
const dao = require("./custom-exercise-dao");
const setDao = require("../sets/set-dao");
const { mutateWorkout } = require("../workouts/workout-store");

// Ejercicios de sesión embebidos en su Workout, con las series dentro.
const db = useTestDb();

async function seed(exercises) {
  return Workout.create({ name: "Torso", exercises });
}

const exercisesOf = async (workoutId) => (await Workout.findById(workoutId).lean()).exercises;

// Bug real: SET_UPDATE_FIELDS no incluía "restSeconds" y el descanso pautado
// nunca llegaba a Mongo.
test("updateCustomExercise persiste restSeconds y lo borra cuando llega null", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), sets: [{ weight: 80 }] }]);
  const customExercise = workout.exercises[0];
  const setId = customExercise.sets[0]._id;

  await dao.updateCustomExercise({ _id: customExercise._id, sets: [{ _id: setId, weight: 80, restSeconds: 90 }] }, [], [], []);
  assert.equal((await exercisesOf(workout._id))[0].sets[0].restSeconds, 90);

  // submit() en ManageSetComponent manda null explícito al desactivar el descanso.
  await dao.updateCustomExercise({ _id: customExercise._id, sets: [{ _id: setId, weight: 80, restSeconds: null }] }, [], [], []);
  assert.equal((await exercisesOf(workout._id))[0].sets[0].restSeconds, undefined);
});

test("updateCustomExercise guarda la lista tal cual: actualiza, crea las de id temporal y quita las borradas", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), sets: [{ reps: 1 }, { reps: 2 }, { reps: 3 }] }]);
  const [first, second, third] = workout.exercises[0].sets;

  const result = await dao.updateCustomExercise(
    {
      _id: workout.exercises[0]._id,
      notes: "Baja lento",
      sets: [
        { _id: third._id, reps: 30 },
        { _id: "1700000000000", reps: 99 },
        { _id: first._id, reps: 10, donedAt: new Date("1999-01-01") },
        { _id: second._id, reps: 20 },
      ],
    },
    [{ _id: "1700000000000", expectedReps: [12] }],
    [],
    [String(second._id)],
  );

  assert.deepEqual(result.sets.map((set) => [set.reps, set.order]), [[30, 0], [99, 1], [10, 2]]);
  assert.deepEqual(result.sets[1].expectedReps, [12]);
  assert.notEqual(String(result.sets[1]._id), "1700000000000");
  assert.equal(String(result.sets[0]._id), String(third._id), "las existentes conservan su id");
  assert.equal(result.sets[2].donedAt, undefined, "donedAt no se acepta del cliente");
  assert.equal(result.notes, "Baja lento");
});

test("updateCustomExercise nunca toca ni engancha una serie de OTRO ejercicio", async () => {
  await db.reset();
  const workout = await seed([
    { exercise: db.oid(), sets: [{ reps: 1 }] },
    { exercise: db.oid(), sets: [{ reps: 2 }] },
  ]);
  const foreignSet = workout.exercises[1].sets[0];

  const result = await dao.updateCustomExercise(
    { _id: workout.exercises[0]._id, sets: [{ _id: foreignSet._id, reps: 50 }] },
    [],
    [],
    [],
  );

  assert.equal(result.sets.length, 1);
  assert.notEqual(String(result.sets[0]._id), String(foreignSet._id), "entra como serie nueva");
  const saved = await exercisesOf(workout._id);
  assert.equal(saved[1].sets[0].reps, 2, "la del otro ejercicio no cambia");
});

test("notas: la del entrenador se borra si falta; la del cliente solo si llega vacía", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), notes: "Del entrenador", clientNotes: "Del cliente", sets: [] }]);
  const id = workout.exercises[0]._id;

  let result = await dao.updateCustomExercise({ _id: id, sets: [] }, [], [], []);
  assert.equal(result.notes, undefined);
  assert.equal(result.clientNotes, "Del cliente", "sin la clave, la nota del cliente se queda");

  result = await dao.updateCustomExercise({ _id: id, sets: [], clientNotes: "" }, [], [], []);
  assert.equal(result.clientNotes, undefined);

  result = await dao.updateClientNotes(id, "  Me molestó el hombro ");
  assert.equal(result.clientNotes, "Me molestó el hombro");
});

test("addSetToCustomExercise y copySetOnCustomExercise añaden series con id nuevo y orden renumerado", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), sets: [{ reps: 1, order: 0 }, { reps: 2, order: 1 }] }]);
  const id = workout.exercises[0]._id;
  const [a, b] = workout.exercises[0].sets;

  let result = await dao.addSetToCustomExercise(id, { _id: "123", reps: 3, doned: true, donedAt: new Date() });
  assert.deepEqual(result.sets.map((set) => [set.reps, set.order]), [[1, 0], [2, 1], [3, 2]]);
  assert.equal(result.sets[2].donedAt, undefined);

  result = await dao.copySetOnCustomExercise(1, {
    _id: id,
    sets: [
      { _id: a._id, reps: 1, order: 0 },
      { reps: 1, order: 1 },
      { _id: b._id, reps: 2, order: 2 },
      { _id: result.sets[2]._id, reps: 3, order: 3 },
    ],
  });
  assert.deepEqual(result.sets.map((set) => set.reps), [1, 1, 2, 3]);
  assert.equal(new Set(result.sets.map((set) => String(set._id))).size, 4);
});

test("deleteCustomExercises quita los ejercicios de su sesión (con sus series)", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), sets: [{ reps: 1 }] }, { exercise: db.oid(), sets: [] }]);
  const [first, second] = workout.exercises;

  assert.deepEqual(await dao.deleteCustomExercises([first._id, "basura"]), { deletedCount: 1 });
  const saved = await exercisesOf(workout._id);
  assert.deepEqual(saved.map((exercise) => String(exercise._id)), [String(second._id)]);
  assert.equal(await dao.loadCustomExercise(first._id), null);
});

test("setCustomExerciseBlock: el bloque tiene que existir y se propaga a la misma fila de los demás microciclos", async () => {
  await db.reset();
  const exerciseId = db.oid();
  const blockId = db.oid();
  const w1 = await Workout.create({ name: "A", blocks: [{ _id: blockId, name: "Superserie" }], exercises: [{ exercise: exerciseId }] });
  const w2 = await Workout.create({ name: "A", blocks: [{ _id: blockId, name: "Superserie" }], exercises: [{ exercise: exerciseId }] });
  const w3 = await Workout.create({ name: "A", blocks: [], exercises: [{ exercise: exerciseId }] });
  await Table.create({
    name: "Rutina",
    userId: db.oid(),
    splits: [{ workouts: [w1._id] }, { workouts: [w2._id] }, { workouts: [w3._id] }],
  });

  await assert.rejects(() => dao.setCustomExerciseBlock(w1.exercises[0]._id, db.oid()), { code: "BLOCK_NOT_FOUND" });

  const result = await dao.setCustomExerciseBlock(w1.exercises[0]._id, blockId);
  assert.equal(String(result.blockId), String(blockId));
  assert.deepEqual(result.rowUpdates.map((update) => String(update._id)), [String(w2.exercises[0]._id)]);
  assert.equal(String((await exercisesOf(w2._id))[0].blockId), String(blockId));
  assert.equal((await exercisesOf(w3._id))[0].blockId, null, "donde no existe el bloque no se toca");
});

test("compare-and-swap: una serie marcada a mitad de reescribir la lista no se pierde", async () => {
  await db.reset();
  const workout = await seed([{ exercise: db.oid(), sets: [{ reps: 1 }, { reps: 2 }] }]);
  const [first, second] = workout.exercises[0].sets;

  let attempts = 0;
  await mutateWorkout({ _id: workout._id }, async (current) => {
    attempts += 1;
    // Otra petición marca la segunda serie mientras esta reescribe la lista.
    if (attempts === 1) await setDao.updateSet({ _id: second._id, doned: true });
    const exercise = current.exercises[0];
    return {
      exercises: [{ ...exercise, sets: exercise.sets.map((set) => (String(set._id) === String(first._id) ? { ...set, reps: 10 } : set)) }],
    };
  });

  assert.equal(attempts, 2, "el primer intento choca y se reintenta");
  const sets = (await exercisesOf(workout._id))[0].sets;
  assert.equal(sets[0].reps, 10);
  assert.equal(sets[1].doned, true);
});
