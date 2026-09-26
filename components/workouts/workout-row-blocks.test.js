const test = require("node:test");
const assert = require("node:assert/strict");
const { diffBlocks, applyBlockDiff, pickRowExercise } = require("./workout-row-blocks");

const block = (id, name, extra = {}) => ({ _id: id, name, type: "straight", ...extra });

test("diffBlocks separa altas, cambios y bajas por _id", () => {
  const diff = diffBlocks(
    [block("a", "A"), block("b", "B")],
    [block("b", "B2"), block("c", "C")],
  );
  assert.deepEqual(diff.added.map((b) => b._id), ["c"]);
  assert.deepEqual(diff.updated.map((b) => b.name), ["B2"]);
  assert.deepEqual(diff.removedIds, ["a"]);
});

test("applyBlockDiff crea, renombra y borra solo los bloques compartidos", () => {
  const sibling = [block("a", "A"), block("b", "B"), block("local", "Solo aquí")];
  const diff = diffBlocks([block("a", "A"), block("b", "B")], [block("b", "Renombrado", { type: "superset" }), block("c", "Nuevo")]);
  const result = applyBlockDiff(sibling, diff);
  assert.deepEqual(result.map((b) => `${b._id}:${b.name}`), ["b:Renombrado", "local:Solo aquí", "c:Nuevo"]);
  assert.equal(result[0].type, "superset");
});

test("un bloque antiguo (solo en el origen) no toca a los demás microciclos", () => {
  const diff = diffBlocks([block("viejo", "Viejo")], []);
  const sibling = [block("otro", "Otro")];
  assert.deepEqual(applyBlockDiff(sibling, diff), sibling);
});

test("applyBlockDiff no duplica un alta que ya existe", () => {
  const diff = diffBlocks([], [block("c", "C")]);
  assert.equal(applyBlockDiff([block("c", "C")], diff).length, 1);
});

test("pickRowExercise: misma posición y mismo ejercicio; si no, el primero igual", () => {
  const list = [{ _id: "1", exercise: { _id: "press" } }, { _id: "2", exercise: "remo" }];
  assert.equal(pickRowExercise(1, "remo", list)._id, "2");
  assert.equal(pickRowExercise(0, "remo", list)._id, "2");
  assert.equal(pickRowExercise(0, "sentadilla", list), null);
  assert.equal(pickRowExercise(0, null, list), null);
});
