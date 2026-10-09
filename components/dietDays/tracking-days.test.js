const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTrackingDays } = require("./tracking-days");
const { computeDayCompletion, computeDayTracking, computeRangeAdherence } = require("./diet-days-nutrition-util");

// Qué días mide la ficha del profesional (tracking-days.js). El caso que
// importa: una fase que el cliente no sigue (nunca elige menú) tiene que
// verse como 0 % cumplido, no como "sin datos".

const TRAINER = "6a86feb4a4a80dd5286b0595";
const TODAY = "2026-10-08";

const item = (name, kcal, quantity = 100) => ({ name, quantity, energyKcal100g: kcal, protein100g: 0, carbohydrates100g: 0, fat100g: 0 });

function phase({ startDate = "2026-10-01", endDate = null, trainerId = TRAINER, contents } = {}) {
  return {
    _id: `phase-${startDate}`,
    startDate,
    endDate,
    trainerId,
    createdAt: new Date(`${startDate}T10:00:00Z`),
    contents: contents || [
      {
        _id: "c1",
        startDate,
        menus: [
          {
            name: "A",
            meals: [
              { slot: "Desayuno", alternatives: [{ customProducts: [], customRecipes: [] }, { customProducts: [item("Avena", 400)] }] },
              { slot: "Comida", alternatives: [{ customProducts: [item("Pollo", 600)] }, { customProducts: [item("Salmón", 900)] }] },
            ],
          },
          { name: "B", meals: [{ slot: "Cena", alternatives: [{ customProducts: [item("Huevos", 300)] }] }] },
        ],
      },
    ],
  };
}

const build = (args) => buildTrackingDays({ from: "2026-10-01", to: TODAY, today: TODAY, dietDays: [], phases: [phase()], ...args });
const byDate = (days) => new Map(days.map((day) => [day.date, day]));

test("buildTrackingDays", async (t) => {
  await t.test("los días pasados de la fase sin menú elegido cuentan con lo pautado y nada tomado", () => {
    const days = build();
    assert.deepEqual(days.map((day) => day.date), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);

    const [first] = days;
    assert.deepEqual(computeDayCompletion(first.meals), { hasPlan: true, completionPercentage: 0 });
    // Menú por defecto = el primero, con la primera alternativa que lleva algo
    // de cada comida: Avena (400) + Pollo (600).
    const tracking = computeDayTracking(first.meals);
    assert.equal(tracking.planned.kcal, 1000);
    assert.equal(tracking.consumed.kcal, 0);
    assert.ok(first.meals.flatMap((meal) => meal.customProducts).every((cp) => String(cp.assignedByTrainerId) === TRAINER && cp.consumed === false));

    const adherence = computeRangeAdherence(days, 8);
    assert.equal(adherence.percentage, 0);
    assert.equal(adherence.daysWithData, 7);
  });

  await t.test("hoy y los días por venir no cuentan si aún no ha elegido: todavía puede", () => {
    const days = build({ to: "2026-10-12" });
    assert.equal(days[days.length - 1].date, "2026-10-07");
  });

  await t.test("un día con menú elegido, con algo pautado o saltado se mide tal cual", () => {
    const chosen = { date: "2026-10-02", menuName: "B", meals: [{ customProducts: [{ ...item("Huevos", 300), assignedByTrainerId: TRAINER, consumed: true }] }] };
    const skipped = { date: "2026-10-03", skipped: true, menuName: null, meals: [{ customProducts: [item("Pizza", 800)] }] };
    const planned = { date: "2026-10-04", menuName: null, meals: [{ customProducts: [{ ...item("Arroz", 350), assignedByTrainerId: TRAINER, consumed: false }] }] };
    const days = byDate(build({ dietDays: [chosen, skipped, planned] }));

    assert.equal(days.get("2026-10-02"), chosen);
    assert.equal(days.get("2026-10-03"), skipped);
    assert.equal(computeDayCompletion(days.get("2026-10-03").meals).hasPlan, false, "saltado: no se le pauta nada");
    assert.equal(days.get("2026-10-04"), planned);
  });

  await t.test("lo que anotó por su cuenta un día sin menú se queda junto a lo pautado", () => {
    const own = { date: "2026-10-02", menuName: null, meals: [{ customProducts: [item("Pizza", 800)] }] };
    const day = byDate(build({ dietDays: [own] })).get("2026-10-02");

    assert.deepEqual(computeDayCompletion(day.meals), { hasPlan: true, completionPercentage: 0 });
    const tracking = computeDayTracking(day.meals);
    assert.equal(tracking.planned.kcal, 1000);
    assert.equal(tracking.consumed.kcal, 800);
  });

  await t.test("fuera de cualquier fase no se inventa plan; lo materializado sigue", () => {
    const before = { date: "2026-09-29", menuName: null, meals: [{ customProducts: [item("Pizza", 800)] }] };
    const days = build({ from: "2026-09-28", to: "2026-09-30", dietDays: [before] });
    assert.deepEqual(days, [before]);
  });

  await t.test("cada día se mide con la fase y la versión del contenido que lo cubren", () => {
    const first = phase({ startDate: "2026-09-20", endDate: "2026-10-02" });
    const second = phase({
      startDate: "2026-10-03",
      contents: [
        { _id: "s1", startDate: "2026-10-03", menus: [{ name: "Único", meals: [{ slot: "Cena", alternatives: [{ customProducts: [item("Salmón", 500)] }] }] }] },
        { _id: "s2", startDate: "2026-10-06", menus: [{ name: "Único", meals: [{ slot: "Cena", alternatives: [{ customProducts: [item("Salmón", 700)] }] }] }] },
      ],
    });
    const days = byDate(build({ phases: [first, second] }));
    const kcal = (date) => computeDayTracking(days.get(date).meals).planned.kcal;

    assert.equal(kcal("2026-10-02"), 1000);
    assert.equal(kcal("2026-10-03"), 500);
    assert.equal(kcal("2026-10-06"), 700, "semana preparada: manda su versión desde su inicio");
  });

  await t.test("una fase sin profesional ya no pauta nada", () => {
    assert.deepEqual(build({ phases: [phase({ trainerId: null })] }), []);
  });
});
