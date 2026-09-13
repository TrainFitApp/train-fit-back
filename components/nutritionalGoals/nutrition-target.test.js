const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bmrMifflinStJeor,
  getFinalWeight,
  energyExpenditure,
  computeNutritionTarget,
  expectedWeeklyRateKg,
} = require("./nutrition-target");

// Estos números deciden qué le manda comer un entrenador a alguien. Cada
// caso lleva la cuenta hecha a mano al lado — un cambio en la fórmula que
// no toque estos valores no debería colar.

test("bmrMifflinStJeor", async (t) => {
  await t.test("hombre 80kg 180cm 30a → 1780", () => {
    assert.equal(bmrMifflinStJeor({ weightKg: 80, heightCm: 180, age: 30, sex: 1 }), 1780);
  });
  await t.test("mujer 60kg 165cm 30a → 1305.25 - 161 ≈ 1175", () => {
    // 10·60 + 6.25·165 − 5·30 − 161 = 600 + 1031.25 − 150 − 161 = 1320.25 → 1320
    assert.equal(bmrMifflinStJeor({ weightKg: 60, heightCm: 165, age: 30, sex: 0 }), 1320);
  });
  await t.test("datos incompletos → null", () => {
    assert.equal(bmrMifflinStJeor({ weightKg: 80, heightCm: 180, age: null, sex: 1 }), null);
  });
});

test("getFinalWeight", async (t) => {
  await t.test("IMC < 30 → peso tal cual", () => {
    assert.equal(getFinalWeight(80, 180, 1), 80);
  });
  await t.test("IMC ≥ 30 → peso ajustado hacia el ideal", () => {
    // 110kg / 1.75² = 35.9 → ajusta. ideal = 50 + 0.91·(175−152.4) = 70.566
    // final = 70.566 + 0.4·(110 − 70.566) = 70.566 + 15.7736 = 86.34
    const w = getFinalWeight(110, 175, 1);
    assert.ok(Math.abs(w - 86.34) < 0.1, `esperaba ~86.34, salió ${w}`);
  });
});

test("energyExpenditure", async (t) => {
  await t.test("sin contar pasos → bmr · activity · training", () => {
    // 1780 · 1.45 · 1.05 = 2710.05
    assert.ok(Math.abs(energyExpenditure(1780, { activity: 1.45, steps: 1, training: 1.05 }) - 2710.05) < 0.01);
  });
  await t.test("con pasos → bmr · training (activity ignorado)", () => {
    assert.equal(energyExpenditure(1780, { activity: 1.45, steps: 1.37, training: 1.2 }), 2136);
  });
});

test("computeNutritionTarget", async (t) => {
  await t.test("hombre en déficit −500", () => {
    const r = computeNutritionTarget({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex: 1,
      activity: 1.45,
      steps: 1,
      training: 1.05,
      objetiveKcalDelta: -500,
    });
    assert.equal(r.kcal, 2210); // round(2710.05 − 500)
    assert.equal(r.protein, 128); // 1.6 · 80
    assert.equal(r.fat, 60); // 0.75 · 80 (hombre, déficit)
    assert.equal(r.carbs, 289.5); // (2210 − 512 − 540) / 4
  });

  await t.test("mujer en mantenimiento, con pasos", () => {
    const r = computeNutritionTarget({
      weightKg: 60,
      heightCm: 165,
      age: 30,
      sex: 0,
      steps: 1.37,
      training: 1.2,
      objetiveKcalDelta: 0,
    });
    // bmr 1320 · 1.2 = 1584
    assert.equal(r.kcal, 1584);
    assert.equal(r.protein, 90); // 1.5 · 60
    assert.equal(r.fat, 60); // 1.0 · 60 (mujer, mantenimiento)
    assert.equal(r.carbs, 171); // (1584 − 360 − 540) / 4
  });

  await t.test("datos biométricos incompletos → null", () => {
    assert.equal(
      computeNutritionTarget({ weightKg: 80, heightCm: null, age: 30, sex: 1 }),
      null
    );
  });

  await t.test("override g/kg del cajón de sugerencias pisa la fórmula por defecto", () => {
    const r = computeNutritionTarget({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex: 1,
      activity: 1.45,
      steps: 1,
      training: 1.05,
      objetiveKcalDelta: -500,
      proteinPerKg: 2,
      fatPerKg: 0.8,
    });
    assert.equal(r.kcal, 2210); // el override de macros no toca las kcal
    assert.equal(r.protein, 160); // 2 · 80, no la fórmula por defecto (128)
    assert.equal(r.fat, 64); // 0.8 · 80, no la fórmula por defecto (60)
    assert.equal(r.carbs, (2210 - 640 - 576) / 4);
  });

  await t.test("override no positivo (0/negativo) se ignora, cae a la fórmula", () => {
    const r = computeNutritionTarget({
      weightKg: 80,
      heightCm: 180,
      age: 30,
      sex: 1,
      activity: 1.45,
      steps: 1,
      training: 1.05,
      objetiveKcalDelta: -500,
      proteinPerKg: 0,
      fatPerKg: -1,
    });
    assert.equal(r.protein, 128);
    assert.equal(r.fat, 60);
  });
});

test("expectedWeeklyRateKg", async (t) => {
  await t.test("déficit −500 → ≈ −0.45 kg/sem", () => {
    assert.equal(expectedWeeklyRateKg(-500), -0.45);
  });
  await t.test("superávit +300 → ≈ +0.27 kg/sem", () => {
    assert.equal(expectedWeeklyRateKg(300), 0.27);
  });
  await t.test("mantenimiento → 0", () => {
    assert.equal(expectedWeeklyRateKg(0), 0);
  });
});
