const test = require("node:test");
const assert = require("node:assert/strict");
const { isSamePermutation } = require("./permutation-util");

// Compartida por split-dao.js (reordenar microciclos) y workout-dao.js
// (reordenar los ejercicios de una sesión). Una regresión aquí podría borrar
// o duplicar microciclos o ejercicios enteros.
test("isSamePermutation", async (t) => {
  await t.test("misma lista en distinto orden -> válida", () => {
    assert.equal(isSamePermutation(["a", "b", "c"], ["c", "a", "b"]), true);
  });

  await t.test("longitud distinta -> inválida", () => {
    assert.equal(isSamePermutation(["a", "b", "c"], ["a", "b"]), false);
  });

  await t.test("id repetido -> inválida", () => {
    assert.equal(isSamePermutation(["a", "b", "c"], ["a", "a", "c"]), false);
  });

  await t.test("id ajeno -> inválida", () => {
    assert.equal(isSamePermutation(["a", "b", "c"], ["a", "b", "zzz"]), false);
  });

  await t.test("no-array -> inválida, no lanza", () => {
    assert.equal(isSamePermutation(["a"], null), false);
    assert.equal(isSamePermutation(["a"], "no soy un array"), false);
  });

  await t.test("ambas vacías -> válida", () => {
    assert.equal(isSamePermutation([], []), true);
  });
});
