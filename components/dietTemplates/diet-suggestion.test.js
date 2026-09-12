const test = require("node:test");
const assert = require("node:assert/strict");
const { rankTemplates } = require("./diet-suggestion");

const TARGET = { kcal: 2500, protein: 180, carbs: 250, fat: 70 };

function cand(id, profile, extra = {}) {
  return { _id: id, name: id, profile, suitableFor: [], suitableForOverride: [], ...extra };
}

test("rankTemplates", async (t) => {
  await t.test("ordena por cercanía; la más parecida primero", () => {
    const { ranked } = rankTemplates(
      [
        cand("lejos", { kcal: 1800, protein: 120, carbs: 180, fat: 50 }),
        cand("cerca", { kcal: 2480, protein: 178, carbs: 245, fat: 72 }),
        cand("media", { kcal: 2200, protein: 160, carbs: 220, fat: 65 }),
      ],
      TARGET
    );
    assert.deepEqual(
      ranked.map((r) => r._id),
      ["cerca", "media", "lejos"]
    );
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[2].rank, 3);
  });

  await t.test("deltas contra el objetivo", () => {
    const { ranked } = rankTemplates([cand("x", { kcal: 2600, protein: 175, carbs: 250, fat: 70 })], TARGET);
    assert.equal(ranked[0].deltas.kcal, 100);
    assert.equal(ranked[0].deltas.protein, -5);
  });

  await t.test("las que no cumplen NO se esconden: salen con missingFlags", () => {
    const { ranked } = rankTemplates(
      [
        cand("vegana", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableFor: ["vegan"] }),
        cand("normal", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableFor: [] }),
      ],
      TARGET,
      ["vegan"]
    );
    assert.equal(ranked.length, 2);
    assert.deepEqual(ranked.find((r) => r._id === "normal").missingFlags, ["vegan"]);
    assert.deepEqual(ranked.find((r) => r._id === "vegana").missingFlags, []);
  });

  // La regla que protege el "aplicar" por defecto del panel: por muy bien
  // que cuadre de macros, una que no cumple nunca se pone la primera.
  await t.test("las que cumplen van delante aunque cuadren peor de macros", () => {
    const { ranked } = rankTemplates(
      [
        cand("clavada_con_gluten", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableFor: [] }),
        cand("regular_sin_gluten", { kcal: 2200, protein: 160, carbs: 220, fat: 62 }, { suitableFor: ["glutenFree"] }),
      ],
      TARGET,
      ["glutenFree"]
    );
    assert.deepEqual(ranked.map((r) => r._id), ["regular_sin_gluten", "clavada_con_gluten"]);
    assert.equal(ranked[0].rank, 1);
  });

  await t.test("dentro de cada bloque manda la distancia", () => {
    const { ranked } = rankTemplates(
      [
        cand("incumple_lejos", { kcal: 1800, protein: 120, carbs: 180, fat: 50 }, { suitableFor: [] }),
        cand("incumple_cerca", { kcal: 2480, protein: 178, carbs: 245, fat: 72 }, { suitableFor: [] }),
        cand("cumple", { kcal: 2000, protein: 140, carbs: 200, fat: 55 }, { suitableFor: ["vegan"] }),
      ],
      TARGET,
      ["vegan"]
    );
    assert.deepEqual(ranked.map((r) => r._id), ["cumple", "incumple_cerca", "incumple_lejos"]);
  });

  await t.test("override cuenta como que cumple", () => {
    const { ranked } = rankTemplates(
      [cand("forzada", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableForOverride: ["vegan"] })],
      TARGET,
      ["vegan"]
    );
    assert.deepEqual(ranked[0].missingFlags, []);
  });

  await t.test("sin restricciones, nadie tiene missingFlags", () => {
    const { ranked } = rankTemplates([cand("x", { kcal: 2500, protein: 180, carbs: 250, fat: 70 })], TARGET);
    assert.deepEqual(ranked[0].missingFlags, []);
  });

  await t.test("kcal pesa más que grasa: 200 kcal de más pierde contra 10 g de grasa de más", () => {
    const { ranked } = rankTemplates(
      [
        cand("kcalOff", { kcal: 2700, protein: 180, carbs: 250, fat: 70 }),
        cand("fatOff", { kcal: 2500, protein: 180, carbs: 250, fat: 80 }),
      ],
      TARGET
    );
    assert.equal(ranked[0]._id, "fatOff");
  });
});
