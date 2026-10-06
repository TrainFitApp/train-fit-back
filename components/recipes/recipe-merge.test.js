const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const service = require("./recipe-merge.service");

// La fusión de una receta con los ajustes que le hizo el cliente, y la
// aritmética de sus macros. Es la copia que usa la API de recetas; las otras
// dos son dietDays/diet-days-nutrition-util.js (adherencia y cumplimiento) y
// RecipeService del front (lo que ve el cliente). Las tres tienen que dar lo
// mismo — ver diet-days-nutrition-util.test.js y, en el front,
// packages/shared-core/src/app/core/services/nutrition-math.test.cjs.

const oid = () => new mongoose.Types.ObjectId().toString();
const base = (id, quantity, extra = {}) => ({
  _id: id,
  quantity,
  energyKcal100g: 100,
  ...extra,
});

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

// --- buildMergedIngredients -------------------------------------------------

test("buildMergedIngredients sin ajustes devuelve la receta tal cual", () => {
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  const { ingredients, removedIngredients } = service.buildMergedIngredients(recipe, {});
  assert.deepEqual(ingredients.map((i) => i._id), ["a", "b"]);
  assert.deepEqual(removedIngredients, []);
});

test("buildMergedIngredients pisa campo a campo, conservando lo que no cambia", () => {
  // Igual que el front: modifiedBaseCustomProducts es un diff parcial.
  const recipe = { customProducts: [base("a", 100, { protein100g: 20 })] };
  const { ingredients } = service.buildMergedIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 250 }],
  });
  assert.equal(ingredients[0].quantity, 250);
  assert.equal(ingredients[0].energyKcal100g, 100);
  assert.equal(ingredients[0].protein100g, 20);
});

test("buildMergedIngredients no escribe sobre el ingrediente de la receta compartida", () => {
  const original = base("a", 100);
  const recipe = { customProducts: [original] };
  service.buildMergedIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 999 }],
  });
  assert.equal(original.quantity, 100);
});

test("buildMergedIngredients separa los eliminados en su propia lista", () => {
  const recipe = { customProducts: [base("a", 100), base("b", 50)] };
  const { ingredients, removedIngredients } = service.buildMergedIngredients(recipe, {
    removedBaseCustomProductIds: ["b"],
  });
  assert.deepEqual(ingredients.map((i) => i._id), ["a"]);
  assert.deepEqual(removedIngredients.map((i) => i._id), ["b"]);
});

test("buildMergedIngredients pone los añadidos al final", () => {
  const recipe = { customProducts: [base("a", 100)] };
  const { ingredients } = service.buildMergedIngredients(recipe, {
    addedCustomProducts: [base("extra", 20)],
  });
  assert.deepEqual(ingredients.map((i) => i._id), ["a", "extra"]);
});

test("buildMergedIngredients clona los arrays en vez de compartirlos", () => {
  // allergens es un array: sin copia, editar la comida de un cliente tocaría
  // la receta que comparten todos.
  const recipe = { customProducts: [base("a", 100)] };
  const allergens = ["gluten"];
  const { ingredients } = service.buildMergedIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", allergens }],
  });
  assert.deepEqual(ingredients[0].allergens, ["gluten"]);
  assert.notEqual(ingredients[0].allergens, allergens, "comparte la referencia");
});

test("buildMergedIngredients llama a toObject en documentos de mongoose", () => {
  const recipe = {
    customProducts: [
      { _id: "a", toObject: () => ({ _id: "a", quantity: 100, energyKcal100g: 100 }) },
    ],
  };
  const { ingredients } = service.buildMergedIngredients(recipe, {
    modifiedBaseCustomProducts: [{ baseCustomProductId: "a", quantity: 200 }],
  });
  assert.deepEqual(ingredients[0], { _id: "a", quantity: 200, energyKcal100g: 100 });
});

// --- calculateMacros --------------------------------------------------------

test("calculateMacros escala por cantidad y acumula el peso crudo", () => {
  assert.deepEqual(
    service.calculateMacros([
      { quantity: 200, energyKcal100g: 100, protein100g: 20, carbohydrates100g: 10, fat100g: 5 },
      { quantity: 100, energyKcal100g: 50, protein100g: 5, carbohydrates100g: 2, fat100g: 1 },
    ]),
    { kcal: 250, protein: 45, carbs: 22, fat: 11, quantity: 300 },
  );
});

test("calculateMacros cae al Product cuando el ingrediente no trae snapshot", () => {
  const macros = service.calculateMacros([
    { quantity: 200, product: { energyKcal100g: 150, protein100g: 10 } },
  ]);
  assert.equal(macros.kcal, 300);
  assert.equal(macros.protein, 20);
});

test("calculateMacros: un 0 del ingrediente gana al valor del catálogo", () => {
  const macros = service.calculateMacros([
    { quantity: 100, fat100g: 0, product: { fat100g: 20 } },
  ]);
  assert.equal(macros.fat, 0);
});

test("calculateMacros ignora las cantidades que no son positivas", () => {
  const macros = service.calculateMacros([
    { quantity: 0, energyKcal100g: 500 },
    { quantity: -100, energyKcal100g: 500 },
    { quantity: null, energyKcal100g: 500 },
  ]);
  assert.equal(macros.kcal, 0);
  assert.equal(macros.quantity, 0);
});

test("calculateMacros de una lista vacía es todo ceros", () => {
  assert.deepEqual(service.calculateMacros([]), {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    quantity: 0,
  });
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
