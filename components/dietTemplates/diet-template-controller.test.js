const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeAlternatives,
  sanitizeMeals,
  sanitizeDays,
  sanitizeDayPatterns,
  sanitizeMode,
} = require("./diet-template-controller");

// Fase 8/9 — estas funciones son la única barrera entre lo que manda el
// cliente (trainer app) y lo que se guarda en DietTemplate. Una regresión
// aquí deja pasar un slot inválido hasta el resolver (plan-resolver.js),
// o un mode que rompe el tercer selector de diet-template-builder.
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

test("sanitizeDays", async (t) => {
  await t.test("dayLabel ausente/vacío cae a 'Día'", () => {
    assert.equal(sanitizeDays([{ meals: [] }])[0].dayLabel, "Día");
    assert.equal(sanitizeDays([{ dayLabel: "   ", meals: [] }])[0].dayLabel, "Día");
  });

  await t.test("dayLabel se recorta a 50 caracteres", () => {
    const result = sanitizeDays([{ dayLabel: "x".repeat(80), meals: [] }]);
    assert.equal(result[0].dayLabel.length, 50);
  });
});

test("sanitizeDayPatterns", async (t) => {
  await t.test("appliesTo descarta valores fuera de 0-6", () => {
    const result = sanitizeDayPatterns([{ name: "Entreno", appliesTo: [1, 2, 7, -1, 3.5, 6] }]);
    assert.deepEqual(result[0].appliesTo, [1, 2, 6]);
  });

  await t.test("appliesTo deduplica", () => {
    const result = sanitizeDayPatterns([{ name: "Entreno", appliesTo: [1, 1, 2, 2] }]);
    assert.deepEqual(result[0].appliesTo, [1, 2]);
  });

  await t.test("name ausente cae a 'Patrón'", () => {
    assert.equal(sanitizeDayPatterns([{ appliesTo: [] }])[0].name, "Patrón");
  });
});

test("sanitizeMode", async (t) => {
  await t.test("recurring y choice pasan tal cual", () => {
    assert.equal(sanitizeMode("recurring"), "recurring");
    assert.equal(sanitizeMode("choice"), "choice");
  });

  await t.test("cualquier otro valor (incluido undefined) cae a sequential", () => {
    assert.equal(sanitizeMode("sequential"), "sequential");
    assert.equal(sanitizeMode(undefined), "sequential");
    assert.equal(sanitizeMode("cualquier-cosa-inventada"), "sequential");
  });
});
