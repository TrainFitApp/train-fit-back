const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestNextCycle, scaleFactor, scaleMealsContent } = require("./cycle-progression");

test("suggestNextCycle", async (t) => {
  await t.test("sin peso → repite el ciclo, no sugiere nada", () => {
    const r = suggestNextCycle({ previousCycleKcal: 2400, weightStartKg: null, weightEndKg: null });
    assert.equal(r.hasData, false);
    assert.equal(r.deltaKcal, 0);
    assert.equal(r.nextCycleKcal, 2400);
    assert.match(r.reason, /no ha metido check-ins/);
  });

  // Plan ciclos por contenido §7: la adherencia baja avisa, no bloquea — el
  // ajuste por peso se calcula igual y decide el entrenador.
  await t.test("adherencia baja → avisa pero calcula igual", () => {
    const r = suggestNextCycle({
      previousCycleKcal: 2400,
      weightStartKg: 80,
      weightEndKg: 79.8, // −0.2 kg/sem, esperaba −0.45 → va lento → baja kcal
      daysElapsed: 7,
      expectedWeeklyRateKg: -0.45,
      adherencePct: 55,
      targetRatePerCycle: -100,
    });
    assert.equal(r.flag, "low_adherence");
    assert.ok(r.deltaKcal < 0);
    assert.match(r.reason, /Adherencia del ciclo 55 %/);
  });

  await t.test("el umbral es 75 %: 74 avisa, 75 no", () => {
    const base = { previousCycleKcal: 2400, weightStartKg: 80, weightEndKg: 79.55, daysElapsed: 7, expectedWeeklyRateKg: -0.45, targetRatePerCycle: -100 };
    assert.equal(suggestNextCycle({ ...base, adherencePct: 74 }).flag, "low_adherence");
    assert.equal(suggestNextCycle({ ...base, adherencePct: 75 }).flag, null);
  });

  await t.test("va según plan → aplica el paso previsto de la rampa", () => {
    const r = suggestNextCycle({
      previousCycleKcal: 2400,
      weightStartKg: 80,
      weightEndKg: 79.55, // −0.45 en 7 días = ritmo esperado
      daysElapsed: 7,
      expectedWeeklyRateKg: -0.45,
      adherencePct: 90,
      targetRatePerCycle: -100,
    });
    assert.equal(r.deltaKcal, -100);
    assert.equal(r.nextCycleKcal, 2300);
  });

  await t.test("peso estancado en un déficit → recorta más de lo previsto", () => {
    const r = suggestNextCycle({
      previousCycleKcal: 2400,
      weightStartKg: 80,
      weightEndKg: 80, // no baja nada
      daysElapsed: 7,
      expectedWeeklyRateKg: -0.45,
      adherencePct: 95,
      targetRatePerCycle: -100,
    });
    // gap = 0 − (−0.45) = +0.45 → corrección = −0.45·7700/7 = −495 → round50 −500 → clamp −400
    assert.equal(r.deltaKcal, -400);
    assert.match(r.reason, /más lento/);
  });

  await t.test("baja demasiado rápido → añade kcal", () => {
    const r = suggestNextCycle({
      previousCycleKcal: 2400,
      weightStartKg: 80,
      weightEndKg: 78.8, // −1.2 kg en 7 días
      daysElapsed: 7,
      expectedWeeklyRateKg: -0.45,
      adherencePct: 95,
      targetRatePerCycle: -100,
    });
    assert.ok(r.deltaKcal > 0, `esperaba +kcal, salió ${r.deltaKcal}`);
    assert.match(r.reason, /más rápido/);
  });

  await t.test("suelo de kcal: nunca sugiere por debajo de 1000", () => {
    const r = suggestNextCycle({
      previousCycleKcal: 1100,
      weightStartKg: 60,
      weightEndKg: 60,
      daysElapsed: 7,
      expectedWeeklyRateKg: -0.45,
      adherencePct: 95,
      targetRatePerCycle: -100,
    });
    assert.equal(r.nextCycleKcal, 1000);
    assert.equal(r.deltaKcal, -100);
  });
});

test("scaleFactor", () => {
  assert.equal(scaleFactor(2400, 2200), 2200 / 2400);
  assert.equal(scaleFactor(0, 2200), 1);
});

test("scaleMealsContent", async (t) => {
  await t.test("escala cantidades de productos y redondea", () => {
    const meals = [
      {
        slot: "Comida",
        alternatives: [{ customProducts: [{ product: "p1", quantity: 200 }, { product: "p2", quantity: 100 }] }],
      },
    ];
    const scaled = scaleMealsContent(meals, 0.9);
    assert.equal(scaled[0].alternatives[0].customProducts[0].quantity, 180);
    assert.equal(scaled[0].alternatives[0].customProducts[1].quantity, 90);
    // no muta el original
    assert.equal(meals[0].alternatives[0].customProducts[0].quantity, 200);
  });

  await t.test("cantidad mínima 1 g", () => {
    const scaled = scaleMealsContent(
      [{ slot: "x", alternatives: [{ customProducts: [{ quantity: 2 }] }] }],
      0.1
    );
    assert.equal(scaled[0].alternatives[0].customProducts[0].quantity, 1);
  });
});
