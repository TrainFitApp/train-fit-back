const { test } = require("node:test");
const assert = require("node:assert/strict");
const { patchCustomProduct, areValuesEqual } = require("./custom-product-patch");
const { NUTRIENT_FIELDS } = require("../util/nutrient-fields");

// Qué se guarda y qué se quita al editar un alimento: un campo que caiga del
// lado equivocado se pierde o se queda pegado sin que nada avise.
const base = { energyKcal100g: 100, protein100g: 10, carbohydrates100g: 20, fat100g: 2 };
const patch = (current, data, options = {}) =>
  patchCustomProduct(current, data, { overrideFields: NUTRIENT_FIELDS, baseProduct: base, blankUnsets: true, ...options });

test("guarda el macro que se aparta del producto del catálogo", () => {
  assert.equal(patch({ quantity: 100 }, { energyKcal100g: 150 }).energyKcal100g, 150);
});

test("quita el macro que vuelve a coincidir con el catálogo (también con tolerancia de coma flotante)", () => {
  assert.equal("energyKcal100g" in patch({ energyKcal100g: 150 }, { energyKcal100g: 100 }), false);
  assert.ok(areValuesEqual(0.1 + 0.2, 0.3));
  assert.equal("protein100g" in patch({}, { protein100g: 10.000000000001 }), false);
});

test("quita el macro que no viene en la petición o llega vacío", () => {
  const next = patch({ energyKcal100g: 150, fat100g: 5 }, { fat100g: "  " });
  assert.equal("energyKcal100g" in next, false);
  assert.equal("fat100g" in next, false);
});

test("guarda un macro a 0 y respeta un null explícito", () => {
  const next = patch({}, { energyKcal100g: 0, protein100g: null });
  assert.equal(next.energyKcal100g, 0);
  assert.equal(next.protein100g, null);
});

test("los campos que no son macros se guardan tal cual; un texto vacío los quita; _id nunca", () => {
  const next = patch({ _id: "a", ingredients: "x", quantity: 50 }, { _id: "b", quantity: 80, consumed: true, ingredients: "" });
  assert.equal(next._id, "a");
  assert.equal(next.quantity, 80);
  assert.equal(next.consumed, true);
  assert.equal("ingredients" in next, false);
});

test("sin blankUnsets (recetas) un texto vacío se escribe y los campos protegidos no se tocan", () => {
  const next = patchCustomProduct(
    { notes: "a", assignedByTrainerId: "t" },
    { notes: "", assignedByTrainerId: "otro" },
    { overrideFields: [], blankUnsets: false, protectedFields: ["assignedByTrainerId"] },
  );
  assert.equal(next.notes, "");
  assert.equal(next.assignedByTrainerId, "t");
});
