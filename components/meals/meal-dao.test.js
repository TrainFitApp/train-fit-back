const test = require("node:test");
const assert = require("node:assert/strict");
const { keptOnPaste } = require("./meal-dao");

// Qué se queda en la comida destino al pegar (meal-dao.js#keptOnPaste). Lo
// pautado solo lo rehace su profesional: un pegado del cliente nunca se lo
// lleva, combine o reemplace.
const planned = { _id: "a", assignedByTrainerId: "6a6f000000000000000000aa" };
const own = { _id: "b", assignedByTrainerId: null };
const legacyOwn = { _id: "c" };

test("keptOnPaste", async (t) => {
  await t.test("combinar deja todo, pautado y propio", () => {
    assert.deepEqual(keptOnPaste([planned, own, legacyOwn], { merge: true }), [planned, own, legacyOwn]);
    assert.deepEqual(keptOnPaste([planned, own], { merge: true, byTrainer: true }), [planned, own]);
  });

  await t.test("el cliente reemplazando quita solo lo suyo", () => {
    assert.deepEqual(keptOnPaste([planned, own, legacyOwn]), [planned]);
    assert.deepEqual(keptOnPaste([planned, own], { merge: false, byTrainer: false }), [planned]);
  });

  await t.test("el profesional reemplazando rehace su pauta entera", () => {
    assert.deepEqual(keptOnPaste([planned, own], { merge: false, byTrainer: true }), []);
  });

  await t.test("sin contenido devuelve un array vacío", () => {
    assert.deepEqual(keptOnPaste(undefined), []);
    assert.deepEqual(keptOnPaste(null, { merge: true }), []);
  });
});
