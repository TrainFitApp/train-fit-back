const test = require("node:test");
const assert = require("node:assert/strict");
const { keepValidBlockIds, rekeyBlocks, pickRowExercise } = require("./workout-row-blocks");

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
