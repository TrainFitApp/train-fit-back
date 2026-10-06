const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeAlternatives,
  sanitizeMeals,
  sanitizeMenus,
} = require("./diet-template-controller");

// Estas funciones son la única barrera entre lo que manda el cliente
// (trainer app) y lo que se guarda en DietTemplate. Una regresión aquí deja
// pasar un slot inválido hasta el resolver (plan-resolver.js), o dos menús
// con el mismo nombre — y el nombre es la clave con la que el cliente elige.
test("sanitizeAlternatives", async (t) => {
  await t.test("recorta a MAX_ALTERNATIVES (4)", () => {
    const input = Array.from({ length: 6 }, (_, i) => ({ label: `alt${i}` }));
    assert.equal(sanitizeAlternatives(input).length, 4);
  });

  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeAlternatives(null), []);
    assert.deepEqual(sanitizeAlternatives(undefined), []);
    assert.deepEqual(sanitizeAlternatives("no soy un array"), []);
  });

  await t.test("customProducts/customRecipes que no son array se descartan a []", () => {
    const result = sanitizeAlternatives([{ label: "x", customProducts: "no", customRecipes: null }]);
    assert.deepEqual(result[0].customProducts, []);
    assert.deepEqual(result[0].customRecipes, []);
  });

  await t.test("label se recorta a 100 caracteres y se limpia espacios", () => {
    const result = sanitizeAlternatives([{ label: `  ${"a".repeat(150)}  ` }]);
    assert.equal(result[0].label.length, 100);
  });

  await t.test("label ausente -> string vacío, nunca undefined", () => {
    assert.equal(sanitizeAlternatives([{}])[0].label, "");
  });
});

test("sanitizeMeals", async (t) => {
  await t.test("descarta slots que no son un MEAL válido", () => {
    const result = sanitizeMeals([
      { slot: "Desayuno", alternatives: [] },
      { slot: "Merienda-hackeada", alternatives: [] },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].slot, "Desayuno");
  });

  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeMeals(null), []);
  });
});

test("sanitizeMenus", async (t) => {
  await t.test("nombre ausente/vacío cae a 'Menú N'", () => {
    assert.equal(sanitizeMenus([{ meals: [] }])[0].name, "Menú 1");
    assert.equal(sanitizeMenus([{ name: "   ", meals: [] }])[0].name, "Menú 1");
  });

  await t.test("el nombre se recorta a 50 caracteres", () => {
    const result = sanitizeMenus([{ name: "x".repeat(80), meals: [] }]);
    assert.equal(result[0].name.length, 50);
  });

  await t.test("dos menús no pueden llamarse igual", () => {
    const result = sanitizeMenus([{ name: "Entreno" }, { name: "Entreno" }, { name: "Entreno" }]);
    assert.deepEqual(result.map((m) => m.name), ["Entreno", "Entreno (2)", "Entreno (3)"]);
  });
});
