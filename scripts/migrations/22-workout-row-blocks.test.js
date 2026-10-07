const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateWorkoutRowBlocks, unifyRowBlocks } = require("./22-workout-row-blocks");

const db = useTestDb();

const block = (_id, name, type = "superset", order = 0) => ({ _id, name, type, order, rounds: null });
const exercise = (exerciseRef, blockId = null) => ({ _id: db.oid(), exercise: exerciseRef, blockId, sets: [{ _id: db.oid(), reps: 5 }] });

// Rutina de 2 microciclos x 2 filas, sembrada en crudo con la forma antigua:
//  - fila 0: el mismo bloque creado aparte en cada microciclo (_id distinto);
//  - fila 1: un bloque que solo está en el primer microciclo y un ejercicio
//    que apunta a un bloque que ya no existe.
async function seed() {
  await db.reset();
  const press = db.oid();
  const row = db.oid();
  const curl = db.oid();
  const ids = {
    blockM1: db.oid(),
    blockM2: db.oid(),
    onlyM1: db.oid(),
    gone: db.oid(),
    w: [db.oid(), db.oid(), db.oid(), db.oid()],
  };
  await db.raw("workouts").insertMany([
    { _id: ids.w[0], name: "Pierna", blocks: [block(ids.blockM1, "SS")], exercises: [exercise(press, ids.blockM1), exercise(row, ids.blockM1)] },
    { _id: ids.w[1], name: "Torso", blocks: [block(ids.onlyM1, "Final", "finisher")], exercises: [exercise(curl, ids.onlyM1)] },
    { _id: ids.w[2], name: "Pierna", blocks: [block(ids.blockM2, "SS")], exercises: [exercise(press, ids.blockM2), exercise(row)] },
    { _id: ids.w[3], name: "Torso", blocks: [], exercises: [exercise(curl), exercise(press, ids.gone)] },
  ]);
  await db.raw("tables").insertMany([
    { _id: db.oid(), name: "Rutina", splits: [{ _id: db.oid(), workouts: [ids.w[0], ids.w[1]] }, { _id: db.oid(), workouts: [ids.w[2], ids.w[3]] }] },
    { _id: db.oid(), name: "Sin bloques", splits: [{ _id: db.oid(), workouts: [] }] },
  ]);
  return ids;
}

const workout = (id) => db.raw("workouts").findOne({ _id: id });
const blockIds = (doc) => doc.blocks.map((item) => String(item._id));
const exerciseBlockIds = (doc) => doc.exercises.map((item) => (item.blockId ? String(item.blockId) : null));

test("deja los mismos bloques (mismo _id) en toda la fila y ningún blockId huérfano", async () => {
  const ids = await seed();

  const stats = await migrateWorkoutRowBlocks(db.mongoose.connection.db);
  assert.deepEqual(stats, { tables: 1, rows: 2, workouts: 2, orphanBlockIds: 1, unifiedBlocks: 2 });

  const [m1Row0, m1Row1, m2Row0, m2Row1] = await Promise.all(ids.w.map(workout));
  assert.deepEqual(blockIds(m2Row0), [String(ids.blockM1)], "el bloque del M2 toma el _id del M1");
  assert.deepEqual(exerciseBlockIds(m2Row0), [String(ids.blockM1), null], "conserva qué ejercicios tenía dentro");
  assert.deepEqual(blockIds(m2Row1), [String(ids.onlyM1)], "el bloque que solo estaba en M1 se crea en M2");
  assert.deepEqual(exerciseBlockIds(m2Row1), [String(ids.onlyM1), null], "con su ejercicio equivalente; el huérfano se suelta");
  assert.equal(m2Row1.blocks[0].type, "finisher");
  assert.equal(m2Row1.__v, 1, "sube la versión para la concurrencia optimista");
  assert.equal(m2Row1.exercises[0].sets.length, 1, "las series no se tocan");
  assert.deepEqual(blockIds(m1Row0), [String(ids.blockM1)]);
  assert.equal(m1Row1.__v, undefined, "lo que ya cumplía no se escribe");
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  const dry = await migrateWorkoutRowBlocks(nativeDb, { dryRun: true });
  assert.equal(dry.workouts, 2);
  assert.deepEqual(blockIds(await workout(ids.w[2])), [String(ids.blockM2)], "dry-run: sin cambios");

  await migrateWorkoutRowBlocks(nativeDb);
  const again = await migrateWorkoutRowBlocks(nativeDb);
  assert.deepEqual(again, { tables: 0, rows: 0, workouts: 0, orphanBlockIds: 0, unifiedBlocks: 0 });
});

// --- unifyRowBlocks (puro) ---------------------------------------------------

const pureBlock = (id, name, extra = {}) => ({ _id: id, name, type: "straight", order: 0, ...extra });
const pureExercise = (id, ref, blockId = null) => ({ _id: id, exercise: ref, blockId, sets: [{ _id: `${id}-s` }] });
const blockIdsOf = (doc) => doc.exercises.map((item) => item.blockId);

test("unifyRowBlocks: bloques con _id distinto pero mismo tipo y nombre pasan a ser uno solo", () => {
  const row = [
    { _id: "w1", blocks: [pureBlock("a1", "Superserie A", { type: "superset" })], exercises: [pureExercise("1", "press", "a1")] },
    { _id: "w2", blocks: [pureBlock("a2", " superserie a ", { type: "superset" })], exercises: [pureExercise("2", "press", "a2")] },
  ];
  const [first, second] = unifyRowBlocks(row);
  assert.equal(first.changed, false, "el primero ya era la referencia");
  assert.equal(second.changed, true);
  assert.deepEqual(second.blocks.map((item) => [item._id, item.name, item.type]), [["a1", "Superserie A", "superset"]]);
  assert.deepEqual(blockIdsOf(second), ["a1"]);
});

test("unifyRowBlocks: un bloque que solo está en un microciclo se crea en los demás con sus ejercicios", () => {
  const row = [
    {
      _id: "w1",
      blocks: [pureBlock("c", "Circuito", { type: "circuit", rounds: 3 })],
      exercises: [pureExercise("1", "press", "c"), pureExercise("2", "remo", "c"), pureExercise("3", "curl")],
    },
    { _id: "w2", blocks: [], exercises: [pureExercise("4", "press"), pureExercise("5", "remo"), pureExercise("6", "curl")] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => [item._id, item.rounds]), [["c", 3]]);
  assert.deepEqual(blockIdsOf(second), ["c", "c", null]);
});

test("unifyRowBlocks: no roba un ejercicio que ya está en otro bloque", () => {
  const row = [
    { _id: "w1", blocks: [pureBlock("x", "X")], exercises: [pureExercise("1", "press", "x")] },
    { _id: "w2", blocks: [pureBlock("y", "Y")], exercises: [pureExercise("2", "press", "y")] },
  ];
  const [first, second] = unifyRowBlocks(row);
  assert.deepEqual(first.blocks.map((item) => item._id), ["x", "y"]);
  assert.deepEqual(second.blocks.map((item) => item._id), ["x", "y"]);
  assert.deepEqual(blockIdsOf(first), ["x"], "en w1 el press sigue en X; Y llega vacío");
  assert.deepEqual(blockIdsOf(second), ["y"]);
});

test("unifyRowBlocks: tipo y nombre repetidos en un mismo entrenamiento casan por orden de aparición", () => {
  const row = [
    { _id: "w1", blocks: [pureBlock("a", "", { order: 0 }), pureBlock("b", "", { order: 1 })], exercises: [] },
    { _id: "w2", blocks: [pureBlock("c", "", { order: 0 }), pureBlock("d", "", { order: 1 })], exercises: [] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => item._id), ["a", "b"]);
});

test("unifyRowBlocks: un _id compartido gana al nombre, y los datos son los de la primera aparición", () => {
  const row = [
    { _id: "w1", blocks: [pureBlock("a", "Fuerza", { rounds: 2 })], exercises: [] },
    { _id: "w2", blocks: [pureBlock("a", "Renombrado en local", { rounds: 5 })], exercises: [] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => [item._id, item.name, item.rounds]), [["a", "Fuerza", 2]]);
});

test("unifyRowBlocks: suelta los ejercicios que apuntan a un bloque inexistente y normaliza el orden", () => {
  const row = [{ _id: "w1", blocks: [pureBlock("a", "A", { order: 4 })], exercises: [pureExercise("1", "press", "borrado")] }];
  const [only] = unifyRowBlocks(row);
  assert.equal(only.changed, true);
  assert.deepEqual(only.blocks.map((item) => item.order), [0]);
  assert.deepEqual(blockIdsOf(only), [null]);
});

test("unifyRowBlocks es idempotente: una fila ya unificada no cambia", () => {
  const row = [
    { _id: "w1", blocks: [pureBlock("a", "A", { type: "superset" })], exercises: [pureExercise("1", "press", "a")] },
    { _id: "w2", blocks: [pureBlock("a2", "A", { type: "superset" })], exercises: [pureExercise("2", "press")] },
  ];
  const once = unifyRowBlocks(row);
  const twice = unifyRowBlocks(once);
  assert.ok(twice.every((workout) => !workout.changed));
  // w2 ya tenía el bloque: se respeta qué ejercicios metió en él.
  assert.deepEqual(twice.map(blockIdsOf), [["a"], [null]]);
});
