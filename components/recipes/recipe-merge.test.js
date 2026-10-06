const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const service = require("./recipe-merge");

// Saneado de recetas puestas en platos e ingredientes. La fusión y sus macros
// se prueban en dietDays/diet-days-nutrition-util.test.js.

const oid = () => new mongoose.Types.ObjectId().toString();

// --- normalizePositiveNumber ------------------------------------------------

test("normalizePositiveNumber solo acepta números por encima de 0", () => {
  assert.equal(service.normalizePositiveNumber(150), 150);
  assert.equal(service.normalizePositiveNumber("150"), 150);
  assert.equal(service.normalizePositiveNumber("12,5"), null, "la coma decimal no es número aquí");
  for (const value of [0, -5, "", null, undefined, "abc", NaN, Infinity]) {
    assert.equal(service.normalizePositiveNumber(value), null, `valor ${String(value)}`);
  }
});

// --- validateCustomRecipe ---------------------------------------------------

test("validateCustomRecipe exige la receta", () => {
  assert.throws(() => service.validateCustomRecipe({}), /recipe is required/);
});

test("validateCustomRecipe acepta cantidades ausentes pero no basura", () => {
  assert.doesNotThrow(() => service.validateCustomRecipe({ recipe: "r" }));
  assert.doesNotThrow(() => service.validateCustomRecipe({ recipe: "r", quantity: null }));
  assert.throws(
    () => service.validateCustomRecipe({ recipe: "r", quantity: 0 }),
    /quantity must be a positive number/,
  );
  assert.throws(
    () => service.validateCustomRecipe({ recipe: "r", quantity: -1 }),
    /quantity must be a positive number/,
  );
  assert.throws(
    () => service.validateCustomRecipe({ recipe: "r", quantityCooked: "abc" }),
    /quantityCooked must be a positive number/,
  );
});

test("validateCustomRecipe exige que las tres listas sean listas", () => {
  for (const field of [
    "modifiedBaseCustomProducts",
    "removedBaseCustomProductIds",
    "addedCustomProducts",
  ]) {
    assert.throws(
      () => service.validateCustomRecipe({ recipe: "r", [field]: { nope: true } }),
      new RegExp(`${field} must be an array`),
      field,
    );
  }
});

// --- sanitizeCustomProductData ----------------------------------------------

test("sanitizeCustomProductData se queda solo con los campos conocidos", () => {
  const clean = service.sanitizeCustomProductData({
    quantity: 100,
    energyKcal100g: 250,
    campoInventado: "fuera",
    mealId: "tampoco",
  });
  assert.deepEqual(Object.keys(clean).sort(), ["energyKcal100g", "quantity"]);
});

test("sanitizeCustomProductData tira la cantidad que no es positiva", () => {
  assert.equal(service.sanitizeCustomProductData({ quantity: 0 }).quantity, null);
  assert.equal(service.sanitizeCustomProductData({ quantity: "abc" }).quantity, null);
});

test("sanitizeCustomProductData descarta los textos en blanco", () => {
  const clean = service.sanitizeCustomProductData({ ingredients: "   ", vegan: false });
  assert.equal("ingredients" in clean, false);
  assert.equal(clean.vegan, false, "false es un dato, no un hueco");
});

test("sanitizeCustomProductData solo acepta ObjectId válidos como referencia", () => {
  const valid = oid();
  assert.equal(service.sanitizeCustomProductData({ product: valid }).product, valid);
  assert.equal(service.sanitizeCustomProductData({ product: { _id: valid } }).product, valid);
  // Un id inventado no se cuela como referencia: mongo lo rechazaría al
  // guardar y la receta se quedaría a medias.
  assert.equal("product" in service.sanitizeCustomProductData({ product: "no-es-un-id" }), false);
});

test("sanitizeCustomProductData incluye _id y baseCustomProductId solo si se piden", () => {
  const id = oid();
  const baseId = oid();
  const input = { _id: id, baseCustomProductId: baseId, quantity: 10 };

  const byDefault = service.sanitizeCustomProductData(input);
  assert.equal("_id" in byDefault, false);
  assert.equal("baseCustomProductId" in byDefault, false);

  const full = service.sanitizeCustomProductData(input, {
    includeId: true,
    includeBaseCustomProductId: true,
  });
  assert.equal(full._id, id);
  assert.equal(full.baseCustomProductId, baseId);
});

test("sanitizeCustomProductData puede dejar fuera el producto del catálogo", () => {
  const id = oid();
  const clean = service.sanitizeCustomProductData({ product: id }, { includeProduct: false });
  assert.equal("product" in clean, false);
});

test("sanitizeCustomProductData clona los arrays que copia", () => {
  const allergens = ["gluten"];
  const clean = service.sanitizeCustomProductData({ allergens });
  assert.deepEqual(clean.allergens, ["gluten"]);
  assert.notEqual(clean.allergens, allergens);
});
