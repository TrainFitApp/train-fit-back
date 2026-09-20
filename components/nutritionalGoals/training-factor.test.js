const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stepsRangeFromValue,
  stepsRangeFromAverage,
  trainingDaysFromFactors,
  trainingFactor,
} = require("./training-factor");
const { computeNutritionTarget, explainNutritionTarget } = require("./nutrition-target");
const { resolveSteps } = require("./nutrition-target-resolver");

// Tabla portada de shared-ui/constants/training.ts — los números son los
// del front, no se derivan de nada: si cambian allí, cambian aquí a mano.

test("stepsRangeFromAverage — huecos de la tabla repartidos por el punto medio", async (t) => {
  await t.test("bordes", () => {
    assert.equal(stepsRangeFromAverage(0).value, 1.2);
    assert.equal(stepsRangeFromAverage(1499).value, 1.2);
    assert.equal(stepsRangeFromAverage(1500).value, 1.37);
    assert.equal(stepsRangeFromAverage(6499).value, 1.37);
    assert.equal(stepsRangeFromAverage(6500).value, 1.46);
    assert.equal(stepsRangeFromAverage(9499).value, 1.46);
    assert.equal(stepsRangeFromAverage(9500).value, 1.55);
    assert.equal(stepsRangeFromAverage(15499).value, 1.55);
    assert.equal(stepsRangeFromAverage(15500).value, 1.71);
    assert.equal(stepsRangeFromAverage(18499).value, 1.71);
    assert.equal(stepsRangeFromAverage(18500).value, 1.86);
    assert.equal(stepsRangeFromAverage(40000).value, 1.86);
  });
  await t.test("no número o negativo → null", () => {
    assert.equal(stepsRangeFromAverage(null), null);
    assert.equal(stepsRangeFromAverage(-1), null);
    assert.equal(stepsRangeFromAverage("x"), null);
  });
});

test("stepsRangeFromValue", () => {
  assert.equal(stepsRangeFromValue(1).key, "notCounted");
  assert.equal(stepsRangeFromValue(1.46).key, "between7000And9000");
  assert.equal(stepsRangeFromValue(1.5), null);
  assert.equal(stepsRangeFromValue(undefined), null);
});

test("trainingDaysFromFactors — búsqueda inversa", async (t) => {
  await t.test("exacto", () => {
    const d = trainingDaysFromFactors(1.46, 1.387);
    assert.equal(d.id, 3);
    assert.equal(d.exact, true);
  });
  await t.test("no casa → la columna más cercana, exact false", () => {
    const d = trainingDaysFromFactors(1.46, 1.39);
    assert.equal(d.id, 3);
    assert.equal(d.exact, false);
  });
  await t.test("rango desconocido → null", () => {
    assert.equal(trainingDaysFromFactors(1.5, 1.387), null);
    assert.equal(trainingDaysFromFactors(1.46, null), null);
  });
});

test("trainingFactor", () => {
  assert.equal(trainingFactor(1.55, 3), 1.472);
  assert.equal(trainingFactor(1, 1), 1);
  assert.equal(trainingFactor(1.2, 9), null);
  assert.equal(trainingFactor(2, 1), null);
});

test("explainNutritionTarget — mismo resultado que computeNutritionTarget, con la cuenta", async (t) => {
  const params = { weightKg: 80, heightCm: 180, age: 30, sex: 1, activity: 1.45, steps: 1, training: 1.05, objetiveKcalDelta: -500 };
  await t.test("target idéntico", () => {
    assert.deepEqual(explainNutritionTarget(params).target, computeNutritionTarget(params));
  });
  await t.test("desglose sin pasos: entra activity", () => {
    const b = explainNutritionTarget(params).breakdown;
    assert.equal(b.bmr, 1780);
    assert.equal(b.usesActivity, true);
    assert.equal(b.activityFactor, 1.45);
    assert.equal(b.trainingFactor, 1.05);
    // 1780 · 1.45 · 1.05 = 2710.05
    assert.equal(b.expenditure, 2710);
    assert.equal(b.factor, 1.523);
    assert.equal(b.delta, -500);
    assert.equal(b.adjustedWeightKg, null);
    assert.equal(b.proteinPerKg, 1.6);
    assert.equal(b.fatPerKg, 0.75);
  });
  await t.test("desglose con pasos: activity fuera, factor = training", () => {
    const b = explainNutritionTarget({ ...params, steps: 1.46, training: 1.387 }).breakdown;
    assert.equal(b.usesActivity, false);
    assert.equal(b.activityFactor, null);
    assert.equal(b.factor, 1.387);
    assert.equal(b.expenditure, Math.round(1780 * 1.387));
  });
  await t.test("IMC ≥ 30 → adjustedWeightKg informado", () => {
    const b = explainNutritionTarget({ ...params, weightKg: 110, heightCm: 175 }).breakdown;
    assert.equal(b.weightKg, 110);
    assert.ok(Math.abs(b.adjustedWeightKg - 86.3) < 0.1);
  });
  await t.test("g/kg manual se refleja tal cual", () => {
    const b = explainNutritionTarget({ ...params, proteinPerKg: 2, fatPerKg: 1 }).breakdown;
    assert.equal(b.proteinPerKg, 2);
    assert.equal(b.fatPerKg, 1);
  });
  await t.test("sin biométricos → null", () => {
    assert.equal(explainNutritionTarget({ ...params, heightCm: null }), null);
  });
});

test("resolveSteps — perfil vs rango del hábito de pasos", async (t) => {
  const user = { steps: 1.46, training: 1.387 }; // 7000–9000, 3–4 días
  await t.test("sin rango del hábito → perfil", () => {
    const r = resolveSteps(user, null);
    assert.equal(r.stepsFrom, "profile");
    assert.equal(r.stepsValue, 1.46);
    assert.equal(r.trainingValue, 1.387);
    assert.equal(r.trainingDays.id, 3);
  });
  await t.test("rango del hábito → factor recalculado con los mismos días de entreno", () => {
    const r = resolveSteps(user, "betweenThan10000And15000");
    assert.equal(r.stepsFrom, "habit");
    assert.equal(r.stepsValue, 1.55);
    assert.equal(r.stepsRangeKey, "betweenThan10000And15000");
    assert.equal(r.trainingValue, 1.472); // fila 1.55, columna 3–4 días
    assert.equal(r.trainingDays.id, 3);
  });
  await t.test("perfil 'no cuento pasos' + hábito → pasa a fórmula con pasos", () => {
    const r = resolveSteps({ steps: 1, training: 1.05 }, "between7000And9000");
    assert.equal(r.stepsFrom, "habit");
    assert.equal(r.stepsValue, 1.46);
    assert.equal(r.trainingValue, 1.387);
  });
  await t.test("perfil con rango irreconocible → perfil, con motivo", () => {
    const r = resolveSteps({ steps: 1.5, training: 1.3 }, "between7000And9000");
    assert.equal(r.stepsFrom, "profile");
    assert.equal(r.stepsFallbackReason, "profile_unresolved");
  });
});
