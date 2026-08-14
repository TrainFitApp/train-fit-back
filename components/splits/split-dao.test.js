const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidSplitPermutation } = require("./split-dao");

// Planificador visual (Fase C) — isValidSplitPermutation es la única barrera
// entre lo que manda el frontend al arrastrar columnas y lo que reemplaza
// table.splits. Una regresión aquí podría borrar o duplicar semanas enteras
// de una rutina.
test("isValidSplitPermutation", async (t) => {
  await t.test("misma lista en distinto orden -> válida", () => {
    assert.equal(isValidSplitPermutation(["a", "b", "c"], ["c", "a", "b"]), true);
  });

  await t.test("longitud distinta -> inválida", () => {
    assert.equal(isValidSplitPermutation(["a", "b", "c"], ["a", "b"]), false);
    assert.equal(isValidSplitPermutation(["a", "b"], ["a", "b", "c"]), false);
  });

  await t.test("id repetido -> inválida (no puede haber la misma columna dos veces)", () => {
    assert.equal(isValidSplitPermutation(["a", "b", "c"], ["a", "a", "c"]), false);
  });

  await t.test("id ajeno que no pertenece a la tabla -> inválida", () => {
    assert.equal(isValidSplitPermutation(["a", "b", "c"], ["a", "b", "zzz"]), false);
  });

  await t.test("no-array -> inválida, no lanza", () => {
    assert.equal(isValidSplitPermutation(["a"], null), false);
    assert.equal(isValidSplitPermutation(["a"], undefined), false);
    assert.equal(isValidSplitPermutation(["a"], "no soy un array"), false);
  });

  await t.test("ambas vacías -> válida (tabla sin splits)", () => {
    assert.equal(isValidSplitPermutation([], []), true);
  });
});
