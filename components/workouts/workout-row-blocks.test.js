const test = require("node:test");
const assert = require("node:assert/strict");
const { keepValidBlockIds, rekeyBlocks, pickRowExercise, unifyRowBlocks } = require("./workout-row-blocks");

const block = (id, name, extra = {}) => ({ _id: id, name, type: "straight", order: 0, ...extra });
const exercise = (id, ref, blockId = null) => ({ _id: id, exercise: ref, blockId, sets: [{ _id: `${id}-s` }] });
const blockIdsOf = (workout) => workout.exercises.map((item) => item.blockId);

test("keepValidBlockIds suelta los ejercicios cuyo bloque no existe", () => {
  const result = keepValidBlockIds([exercise("1", "press", "a"), exercise("2", "remo", "zz"), exercise("3", "curl")], [block("a", "A")]);
  assert.deepEqual(blockIdsOf({ exercises: result }), ["a", null, null]);
});

test("rekeyBlocks da _id nuevos y traduce el blockId de los ejercicios", () => {
  let next = 0;
  const { blocks, remapExercises } = rekeyBlocks([block("a", "A"), block("b", "B", { order: 1 })], () => `new-${next++}`);
  assert.deepEqual(blocks.map((item) => [item._id, item.name, item.order]), [
    ["new-0", "A", 0],
    ["new-1", "B", 1],
  ]);
  const exercises = remapExercises([exercise("1", "press", "b"), exercise("2", "remo", "fantasma"), exercise("3", "curl")]);
  assert.deepEqual(blockIdsOf({ exercises }), ["new-1", null, null]);
});

test("pickRowExercise: misma posición y mismo ejercicio; si no, el primero igual", () => {
  const list = [{ _id: "1", exercise: { _id: "press" } }, { _id: "2", exercise: "remo" }];
  assert.equal(pickRowExercise(1, "remo", list)._id, "2");
  assert.equal(pickRowExercise(0, "remo", list)._id, "2");
  assert.equal(pickRowExercise(0, "sentadilla", list), null);
  assert.equal(pickRowExercise(0, null, list), null);
});

test("unifyRowBlocks: bloques con _id distinto pero mismo tipo y nombre pasan a ser uno solo", () => {
  const row = [
    { _id: "w1", blocks: [block("a1", "Superserie A", { type: "superset" })], exercises: [exercise("1", "press", "a1")] },
    { _id: "w2", blocks: [block("a2", " superserie a ", { type: "superset" })], exercises: [exercise("2", "press", "a2")] },
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
      blocks: [block("c", "Circuito", { type: "circuit", rounds: 3 })],
      exercises: [exercise("1", "press", "c"), exercise("2", "remo", "c"), exercise("3", "curl")],
    },
    { _id: "w2", blocks: [], exercises: [exercise("4", "press"), exercise("5", "remo"), exercise("6", "curl")] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => [item._id, item.rounds]), [["c", 3]]);
  assert.deepEqual(blockIdsOf(second), ["c", "c", null]);
});

test("unifyRowBlocks: no roba un ejercicio que ya está en otro bloque", () => {
  const row = [
    { _id: "w1", blocks: [block("x", "X")], exercises: [exercise("1", "press", "x")] },
    { _id: "w2", blocks: [block("y", "Y")], exercises: [exercise("2", "press", "y")] },
  ];
  const [first, second] = unifyRowBlocks(row);
  assert.deepEqual(first.blocks.map((item) => item._id), ["x", "y"]);
  assert.deepEqual(second.blocks.map((item) => item._id), ["x", "y"]);
  assert.deepEqual(blockIdsOf(first), ["x"], "en w1 el press sigue en X; Y llega vacío");
  assert.deepEqual(blockIdsOf(second), ["y"]);
});

test("unifyRowBlocks: tipo y nombre repetidos en un mismo entrenamiento casan por orden de aparición", () => {
  const row = [
    { _id: "w1", blocks: [block("a", "", { order: 0 }), block("b", "", { order: 1 })], exercises: [] },
    { _id: "w2", blocks: [block("c", "", { order: 0 }), block("d", "", { order: 1 })], exercises: [] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => item._id), ["a", "b"]);
});

test("unifyRowBlocks: un _id compartido gana al nombre, y los datos son los de la primera aparición", () => {
  const row = [
    { _id: "w1", blocks: [block("a", "Fuerza", { rounds: 2 })], exercises: [] },
    { _id: "w2", blocks: [block("a", "Renombrado en local", { rounds: 5 })], exercises: [] },
  ];
  const [, second] = unifyRowBlocks(row);
  assert.deepEqual(second.blocks.map((item) => [item._id, item.name, item.rounds]), [["a", "Fuerza", 2]]);
});

test("unifyRowBlocks: suelta los ejercicios que apuntan a un bloque inexistente y normaliza el orden", () => {
  const row = [{ _id: "w1", blocks: [block("a", "A", { order: 4 })], exercises: [exercise("1", "press", "borrado")] }];
  const [only] = unifyRowBlocks(row);
  assert.equal(only.changed, true);
  assert.deepEqual(only.blocks.map((item) => item.order), [0]);
  assert.deepEqual(blockIdsOf(only), [null]);
});

test("unifyRowBlocks es idempotente: una fila ya unificada no cambia", () => {
  const row = [
    { _id: "w1", blocks: [block("a", "A", { type: "superset" })], exercises: [exercise("1", "press", "a")] },
    { _id: "w2", blocks: [block("a2", "A", { type: "superset" })], exercises: [exercise("2", "press")] },
  ];
  const once = unifyRowBlocks(row);
  const twice = unifyRowBlocks(once);
  assert.ok(twice.every((workout) => !workout.changed));
  // w2 ya tenía el bloque: se respeta qué ejercicios metió en él.
  assert.deepEqual(twice.map(blockIdsOf), [["a"], [null]]);
});
