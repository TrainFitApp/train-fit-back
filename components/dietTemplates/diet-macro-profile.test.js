const test = require("node:test");
const assert = require("node:assert/strict");
const { cycleMacroProfile } = require("./diet-macro-profile");

// Producto con snapshot de macros por 100 g + cantidad en gramos.
function cp(kcal100, p100, c100, f100, grams) {
  return {
    energyKcal100g: kcal100,
    protein100g: p100,
    carbohydrates100g: c100,
    fat100g: f100,
    quantity: grams,
  };
}

// 100 g de pollo: 165 kcal, 31 P, 0 C, 3.6 F
const POLLO_100 = cp(165, 31, 0, 3.6, 100);
// 100 g de arroz: 130 kcal, 2.7 P, 28 C, 0.3 F
const ARROZ_100 = cp(130, 2.7, 28, 0.3, 100);

test("cycleMacroProfile", async (t) => {
  await t.test("un día, una comida, una alternativa = suma directa", () => {
    const doc = {
      mode: "sequential",
      days: [
        { dayLabel: "D1", meals: [{ slot: "Comida", alternatives: [{ customProducts: [POLLO_100, ARROZ_100] }] }] },
      ],
    };
    const r = cycleMacroProfile(doc);
    assert.equal(r.kcal, 295); // 165 + 130
    assert.equal(r.protein, 33.7); // 31 + 2.7
    assert.equal(r.carbs, 28);
    assert.equal(r.basedOnDays, 1);
  });

  await t.test("media de alternativas por comida", () => {
    const doc = {
      mode: "sequential",
      days: [
        {
          dayLabel: "D1",
          meals: [
            {
              slot: "Comida",
              alternatives: [{ customProducts: [POLLO_100] }, { customProducts: [ARROZ_100] }],
            },
          ],
        },
      ],
    };
    const r = cycleMacroProfile(doc);
    assert.equal(r.kcal, 148); // (165 + 130) / 2 = 147.5 → 148
  });

  await t.test("media de los N días del ciclo", () => {
    const doc = {
      mode: "sequential",
      days: [
        { dayLabel: "D1", meals: [{ slot: "Comida", alternatives: [{ customProducts: [POLLO_100] }] }] },
        { dayLabel: "D2", meals: [{ slot: "Comida", alternatives: [{ customProducts: [ARROZ_100] }] }] },
      ],
    };
    const r = cycleMacroProfile(doc);
    assert.equal(r.kcal, 148); // (165 + 130) / 2
    assert.equal(r.basedOnDays, 2);
  });

  await t.test("recurring: media ponderada por días de la semana que cubre cada patrón", () => {
    const doc = {
      mode: "recurring",
      dayPatterns: [
        { name: "Entreno", appliesTo: [1, 2, 3, 4, 5], meals: [{ slot: "Comida", alternatives: [{ customProducts: [cp(200, 0, 0, 0, 100)] }] }] },
        { name: "Descanso", appliesTo: [0, 6], meals: [{ slot: "Comida", alternatives: [{ customProducts: [cp(100, 0, 0, 0, 100)] }] }] },
      ],
    };
    const r = cycleMacroProfile(doc);
    // (200·5 + 100·2) / 7 = 1200/7 = 171.4 → 171
    assert.equal(r.kcal, 171);
  });

  await t.test("comida sin alternativas aporta 0", () => {
    const doc = {
      mode: "sequential",
      days: [{ dayLabel: "D1", meals: [{ slot: "Comida", alternatives: [] }, { slot: "Cena", alternatives: [{ customProducts: [POLLO_100] }] }] }],
    };
    assert.equal(cycleMacroProfile(doc).kcal, 165);
  });

  await t.test("plantilla vacía → ceros", () => {
    assert.deepEqual(cycleMacroProfile({ mode: "sequential", days: [] }), {
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      basedOnDays: 0,
    });
  });
});
