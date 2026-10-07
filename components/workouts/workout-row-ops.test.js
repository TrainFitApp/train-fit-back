const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("./workout-schema");
const Table = require("../tables/table-schema");
const Exercise = require("../exercises/exercise-schema");
const User = require("../users/user-schema");
const workoutDao = require("./workout-dao");
const workoutService = require("./workout-service");

// Operaciones que actúan sobre una FILA (la misma posición en todos los
// microciclos): bloques, altas, pegar, reordenar, saltar y borrar. Contra un
// Mongo efímero.
const db = useTestDb();

const str = (value) => String(value?._id ?? value);
const blockIdsOf = (workout) => (workout.exercises || []).map((item) => (item.blockId ? str(item.blockId) : null));

// `rows`: por microciclo, la lista de Exercise de su única sesión.
async function seedRow(rows) {
  const workouts = [];
  for (const exercises of rows) {
    workouts.push(
      await Workout.create({
        name: "Día A",
        exercises: exercises.map((exercise) => ({ exercise: exercise._id, sets: [{ reps: 8 }] })),
      }),
    );
  }
  const table = await Table.create({
    name: "Rutina",
    userId: db.oid(),
    splits: workouts.map((workout, index) => ({ name: `M${index + 1}`, workouts: [workout._id] })),
  });
  return { table, workouts };
}

async function exercises(...names) {
  return Promise.all(names.map((name) => Exercise.create({ name })));
}

const load = (id) => Workout.findById(id).lean();

test("updateWorkoutBlocks crea, edita y borra el bloque en TODA la fila", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { workouts } = await seedRow([[press], [press]]);

  const created = await workoutDao.updateWorkoutBlocks(workouts[0]._id, [{ name: "SS", type: "superset", order: 0 }]);
  const blockId = str(created.blocks[0]);
  assert.deepEqual(created.rowWorkouts.map((workout) => workout.blocks.map(str)), [[blockId]], "el otro microciclo, con el mismo _id");

  await Workout.updateMany({}, { $set: { "exercises.0.blockId": created.blocks[0]._id } });
  await workoutDao.updateWorkoutBlocks(workouts[1]._id, [{ _id: blockId, name: "Renombrado", type: "circuit", order: 0 }]);
  for (const workout of workouts) {
    const saved = await load(workout._id);
    assert.deepEqual(saved.blocks.map((item) => [str(item), item.name, item.type]), [[blockId, "Renombrado", "circuit"]]);
  }

  await workoutDao.updateWorkoutBlocks(workouts[1]._id, []);
  for (const workout of workouts) {
    const saved = await load(workout._id);
    assert.deepEqual(saved.blocks, []);
    assert.deepEqual(blockIdsOf(saved), [null], "sus ejercicios quedan sueltos en cada microciclo");
  }
});

test("addWorkoutsToSplits crea la fila con los MISMOS bloques en todos los microciclos", async () => {
  await db.reset();
  const [press, bench] = await exercises("Press", "Banca");
  const { table } = await seedRow([[press], [press]]);

  const splits = await workoutDao.addWorkoutsToSplits(table._id, {
    name: "Nuevo",
    blocks: [{ _id: "temporal", name: "Circuito", type: "circuit", order: 0 }],
    exercises: [
      { exercise: press._id, blockId: "temporal", sets: [{ reps: 10 }] },
      { exercise: bench._id, blockId: "inexistente", sets: [] },
    ],
  });

  const created = await Promise.all(splits.map((split) => load(split.workouts.at(-1)._id)));
  const [first, second] = created;
  assert.equal(first.blocks.length, 1);
  assert.notEqual(str(first.blocks[0]), "temporal");
  assert.deepEqual(second.blocks.map(str), first.blocks.map(str), "mismo _id de bloque en toda la fila");
  assert.deepEqual(blockIdsOf(first), [str(first.blocks[0]), null], "el blockId inexistente se suelta");
  assert.deepEqual(blockIdsOf(second), blockIdsOf(first));
  assert.notEqual(str(first.exercises[0]), str(second.exercises[0]), "cada microciclo con sus propios ejercicios");
});

test("duplicateWorkoutRow: la fila nueva estrena bloques, los mismos en todos sus microciclos", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { table, workouts } = await seedRow([[press], [press]]);
  const [original] = (await workoutDao.updateWorkoutBlocks(workouts[0]._id, [{ name: "SS", type: "superset", order: 0 }])).blocks;
  await Workout.updateMany({}, { $set: { "exercises.0.blockId": original._id } });

  const splits = await workoutDao.duplicateWorkoutRow(table._id, workouts[0]._id, "Copia");
  const copies = await Promise.all(splits.map((split) => load(split.workouts[1]._id)));
  const copyBlockId = str(copies[0].blocks[0]);
  assert.notEqual(copyBlockId, str(original), "no comparte bloques con la fila de origen");
  for (const copy of copies) {
    assert.deepEqual(copy.blocks.map((item) => [str(item), item.name, item.type]), [[copyBlockId, "SS", "superset"]]);
    assert.deepEqual(blockIdsOf(copy), [copyBlockId], "sus ejercicios, en el bloque nuevo");
  }
  for (const workout of workouts) {
    assert.deepEqual((await load(workout._id)).blocks.map(str), [str(original)], "el origen no cambia");
  }
});

test("modifyWorkout no escribe bloques: son de la fila", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { workouts } = await seedRow([[press], [press]]);

  await workoutDao.modifyWorkout({ _id: workouts[0]._id, name: "Otro", blocks: [{ _id: db.oid(), name: "Suelto", type: "circuit" }] });
  const saved = await load(workouts[0]._id);
  assert.equal(saved.name, "Otro");
  assert.deepEqual(saved.blocks, []);
});

test("updateWorkout solo guarda el blockId del ejercicio nuevo si el bloque es de esa sesión", async () => {
  await db.reset();
  const [press, curl] = await exercises("Press", "Curl");
  const { workouts } = await seedRow([[press]]);
  const [own] = (await workoutDao.updateWorkoutBlocks(workouts[0]._id, [{ name: "B", type: "straight", order: 0 }])).blocks;

  await workoutDao.updateWorkout({ _id: workouts[0]._id }, { exercise: curl._id, blockId: own._id, sets: [] });
  await workoutDao.updateWorkout({ _id: workouts[0]._id }, { exercise: curl._id, blockId: db.oid(), sets: [] });
  assert.deepEqual(blockIdsOf(await load(workouts[0]._id)), [null, str(own), null]);
});

test("pasteExercises pega en toda la fila salvo en la sesión de origen", async () => {
  await db.reset();
  const [press, curl] = await exercises("Press", "Curl");
  const { table, workouts } = await seedRow([[press, curl], [press], [press]]);
  const [blocked] = (await workoutDao.updateWorkoutBlocks(workouts[0]._id, [{ name: "B", type: "straight", order: 0 }])).blocks;
  const source = await load(workouts[0]._id);
  const toPaste = [{ ...source.exercises[1], blockId: blocked._id }];

  await workoutDao.pasteExercises(table._id, workouts[0]._id, workouts[1]._id, toPaste);

  const [origin, target, sibling] = await Promise.all(workouts.map((workout) => load(workout._id)));
  assert.equal(origin.exercises.length, 2, "el origen no se duplica");
  for (const workout of [target, sibling]) {
    assert.equal(workout.exercises.length, 2);
    assert.equal(str(workout.exercises[1].exercise), str(curl));
    assert.equal(str(workout.exercises[1].blockId), str(blocked), "el bloque es de la fila: se conserva");
  }
  assert.notEqual(str(target.exercises[1]), str(sibling.exercises[1]));
});

test("pasteWorkout suelta los ejercicios cuyo bloque no tiene el destino", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { workouts } = await seedRow([[press], [press]]);
  const clipboard = { exercises: [{ exercise: press._id, blockId: db.oid(), sets: [] }], notes: "copiado" };

  await workoutDao.pasteWorkout(clipboard, { _id: workouts[1]._id });
  const saved = await load(workouts[1]._id);
  assert.deepEqual(blockIdsOf(saved), [null]);
  assert.equal(saved.notes, "copiado");
});

test("updateWorkoutsOrder no toca un microciclo con otros ejercicios y devuelve los reordenados", async () => {
  await db.reset();
  const [press, row, curl] = await exercises("Press", "Remo", "Curl");
  const { table, workouts } = await seedRow([[press, row], [press, row], [press, row, curl]]);

  const result = await workoutDao.updateWorkoutsOrder(workouts[0]._id, table._id, [1, 0]);
  assert.equal(result.modifiedCount, 2);
  assert.deepEqual(result.rowWorkouts.map(str), [str(workouts[1])]);

  const [first, second, third] = await Promise.all(workouts.map((workout) => load(workout._id)));
  assert.deepEqual(first.exercises.map((item) => str(item.exercise)), [str(row), str(press)]);
  assert.deepEqual(second.exercises.map((item) => str(item.exercise)), [str(row), str(press)]);
  assert.deepEqual(third.exercises.map((item) => str(item.exercise)), [str(press), str(row), str(curl)], "ni se desordena ni pierde ejercicios");

  const invalid = await workoutDao.updateWorkoutsOrder(workouts[0]._id, table._id, [0, 0]);
  assert.equal(invalid.modifiedCount, 0, "solo permutaciones completas");
});

test("skipWorkout solo cierra la sesión en curso si es la saltada", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { workouts } = await seedRow([[press], [press]]);
  const user = await User.create({ email: "skip@x.test", workoutInUse: workouts[1]._id });

  await workoutDao.skipWorkout(workouts[0]._id, user._id, true);
  assert.equal(str((await User.findById(user._id).lean()).workoutInUse), str(workouts[1]), "saltar otro día no corta la sesión abierta");
  assert.equal((await load(workouts[0]._id)).rest, true);

  await workoutDao.skipWorkout(workouts[1]._id, user._id, true);
  assert.equal((await User.findById(user._id).lean()).workoutInUse, undefined);
});

test("deleteWorkoutRows borra la fila entera aunque solo llegue una sesión, e ignora huecos", async () => {
  await db.reset();
  const [press] = await exercises("Press");
  const { table, workouts } = await seedRow([[press], [press], [press]]);

  await workoutService.deleteWorkoutRows([{ _id: workouts[0]._id }, { _id: "no-es-un-id" }, null]);

  assert.equal(await Workout.countDocuments({ _id: { $in: workouts.map((workout) => workout._id) } }), 0);
  const saved = await Table.findById(table._id).lean();
  assert.ok(saved.splits.every((split) => split.workouts.length === 0));
});

test("findSplitWorkoutsWithExercises devuelve las sesiones de ese microciclo con el ejercicio poblado", async () => {
  await db.reset();
  const [press, curl] = await exercises("Press", "Curl");
  const { table } = await seedRow([[press], [curl]]);

  const found = await workoutDao.findSplitWorkoutsWithExercises(table.splits[1]._id);
  assert.deepEqual(found.map((workout) => workout.exercises[0].exercise.name), ["Curl"]);
  assert.deepEqual(await workoutDao.findSplitWorkoutsWithExercises("no-es-un-id"), []);
});
