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

  await t.test("filtro duro: cliente vegano oculta las no aptas", () => {
    const { ranked, hidden } = rankTemplates(
      [
        cand("vegana", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableFor: ["vegan"] }),
        cand("normal", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableFor: [] }),
      ],
      TARGET,
      ["vegan"]
    );
    assert.deepEqual(ranked.map((r) => r._id), ["vegana"]);
    assert.equal(hidden.length, 1);
    assert.deepEqual(hidden[0].missingFlags, ["vegan"]);
  });

  await t.test("override deja pasar el filtro", () => {
    const { ranked } = rankTemplates(
      [cand("forzada", { kcal: 2500, protein: 180, carbs: 250, fat: 70 }, { suitableForOverride: ["vegan"] })],
      TARGET,
      ["vegan"]
    );
    assert.equal(ranked.length, 1);
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
