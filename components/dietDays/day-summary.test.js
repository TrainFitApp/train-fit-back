const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeDay } = require("./day-summary");
const { buildTrackingDays } = require("./tracking-days");
const { computeDayTracking } = require("./diet-days-nutrition-util");

// Resumen de un día para la ficha del profesional (Plan › Nutrición › Día).

const TRAINER = "6a86feb4a4a80dd5286b0595";
const TODAY = "2026-10-08";

const food = (name, kcal, quantity = 100, extra = {}) => ({
  name,
  quantity,
  energyKcal100g: kcal,
  protein100g: 10,
  carbohydrates100g: 20,
  fat100g: 5,
  ...extra,
});
const planned = (name, kcal, quantity = 100, extra = {}) =>
  food(name, kcal, quantity, { assignedByTrainerId: TRAINER, assignedQuantity: quantity, consumed: false, ...extra });

// Fase que empieza el jueves 1 de octubre: S1 = 1-4 oct, S2 = 5-11 oct.
function phase(menus) {
  return {
    _id: "phase-1",
    name: "Definición",
    startDate: "2026-10-01",
    endDate: null,
    trainerId: TRAINER,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    contents: [
      {
        _id: "c1",
        startDate: "2026-10-01",
        menus: menus || [
          {
            name: "Menú A",
            meals: [
              { slot: "Desayuno", alternatives: [{ customProducts: [food("Avena", 400, 50)] }] },
              { slot: "Comida", alternatives: [{ customProducts: [food("Pollo", 200)] }, { customProducts: [food("Salmón", 300)] }] },
            ],
          },
          { name: "Menú B", meals: [{ slot: "Cena", alternatives: [{ customProducts: [food("Huevos", 150)] }] }] },
        ],
      },
    ],
  };
}

const meal = (name, customProducts = [], extra = {}) => ({ name, customProducts, customRecipes: [], ...extra });
const emptyDay = (date, extra = {}) => ({
  date,
  menuName: null,
  skipped: false,
  meals: ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena", "Recena"].map((name) => meal(name)),
  ...extra,
});

test("summarizeDay", async (t) => {
  await t.test("día con menú: lo tomado, lo que no, lo propio, la opción elegida y la desviación", () => {
    const date = "2026-10-06";
    const dietDay = emptyDay(date, {
      menuName: "Menú A",
      notes: "  Cena fuera  ",
      meals: [
        meal("Desayuno", [planned("Avena", 400, 50, { consumed: true })]),
        meal("Almuerzo"),
        meal("Comida", [planned("Salmón", 300, 100, { consumed: true, quantity: 150 }), food("Pan", 250, 40)], {
          alternatives: [{ label: "Pollo", customProducts: [] }, { label: "Salmón", customProducts: [] }],
          chosenAlternativeIndex: 1,
          notes: "Sin sal",
        }),
        meal("Merienda", [planned("Yogur", 60, 125)]),
        meal("Cena"),
        meal("Recena"),
      ],
    });

    const summary = summarizeDay({ date, today: TODAY, dietDay, phases: [phase()] });

    assert.equal(summary.state, "menu");
    assert.equal(summary.menuName, "Menú A");
    assert.deepEqual(summary.menus, ["Menú A", "Menú B"]);
    assert.deepEqual(summary.phase, { _id: "phase-1", name: "Definición", week: 2 });
    assert.equal(summary.notes, "Cena fuera");

    // Solo las comidas con algo, en su orden.
    assert.deepEqual(summary.meals.map((m) => [m.name, m.status]), [
      ["Desayuno", "done"],
      ["Comida", "done"],
      ["Merienda", "unchecked"],
    ]);

    const comida = summary.meals[1];
    assert.deepEqual(comida.options, { chosen: 1, labels: ["Pollo", "Salmón"] });
    assert.equal(comida.notes, "Sin sal");
    assert.deepEqual(
      comida.items.map((i) => [i.name, i.status, i.plannedQuantity, i.quantity, i.kcal]),
      [
        ["Salmón", "eaten", 100, 150, 450],
        ["Pan", "extra", null, 40, 100],
      ]
    );
    // Lo que no marcó se enseña con sus kcal pautadas.
    assert.deepEqual(summary.meals[2].items.map((i) => [i.status, i.kcal]), [["unchecked", 75]]);

    // Pautado = a la cantidad del profesional: 200 + 300 + 75.
    assert.equal(summary.planned.kcal, 575);
    // Tomado = Avena 200 + Salmón 450 (en 150 g) + Pan 100.
    assert.equal(summary.consumed.kcal, 750);
    assert.equal(summary.extra.kcal, 100);
    assert.deepEqual(summary.deviation, { kcal: 175, percentage: 30, withinTolerance: false });
    assert.deepEqual(summary.counts, { planned: 3, eaten: 2, extra: 1 });
    assert.equal(summary.completionPercentage, 67);

    // Cuadra con la gráfica de Seguimiento de ese día.
    const [tracked] = buildTrackingDays({ from: date, to: date, today: TODAY, dietDays: [dietDay], phases: [phase()] });
    const tracking = computeDayTracking(tracked.meals);
    assert.equal(Math.round(tracking.planned.kcal), summary.planned.kcal);
    assert.equal(Math.round(tracking.consumed.kcal), summary.consumed.kcal);
  });

  await t.test("día pasado sin menú elegido: menú por defecto sin tomar, con lo propio en su comida", () => {
    const date = "2026-10-03";
    const dietDay = emptyDay(date, {
      meals: [meal("Desayuno"), meal("Almuerzo"), meal("Comida", [food("Bocadillo", 250, 200)])],
    });

    const summary = summarizeDay({ date, today: TODAY, dietDay, phases: [phase()] });

    assert.equal(summary.state, "unchosen");
    assert.equal(summary.menuName, null);
    assert.equal(summary.phase.week, 1);
    assert.deepEqual(summary.meals.map((m) => [m.name, m.status]), [
      ["Desayuno", "unchecked"],
      ["Comida", "unchecked"],
    ]);
    assert.deepEqual(summary.meals[1].items.map((i) => [i.name, i.status]), [
      ["Bocadillo", "extra"],
      ["Pollo", "unchecked"],
    ]);
    assert.equal(summary.planned.kcal, 400);
    assert.equal(summary.consumed.kcal, 500);
    assert.equal(summary.completionPercentage, 0);
  });

  await t.test("día pasado sin documento: se mide igual, con las comidas nombradas", () => {
    const summary = summarizeDay({ date: "2026-10-02", today: TODAY, dietDay: null, phases: [phase()] });
    assert.equal(summary.state, "unchosen");
    assert.deepEqual(summary.meals.map((m) => m.name), ["Desayuno", "Comida"]);
    assert.deepEqual(summary.counts, { planned: 2, eaten: 0, extra: 0 });
  });

  await t.test("hoy sin menú: pendiente, sin nada pautado ni desviación", () => {
    const summary = summarizeDay({ date: TODAY, today: TODAY, dietDay: emptyDay(TODAY), phases: [phase()] });
    assert.equal(summary.state, "pending");
    assert.deepEqual(summary.meals, []);
    assert.equal(summary.deviation, null);
    assert.equal(summary.completionPercentage, null);
    assert.deepEqual(summary.menus, ["Menú A", "Menú B"]);
  });

  await t.test("día saltado: se queda lo que el cliente anotó por su cuenta", () => {
    const date = "2026-10-05";
    const dietDay = emptyDay(date, { skipped: true, meals: [meal("Cena", [food("Pizza", 270, 300)])] });
    const summary = summarizeDay({ date, today: TODAY, dietDay, phases: [phase()] });
    assert.equal(summary.state, "skipped");
    assert.deepEqual(summary.meals.map((m) => [m.name, m.status]), [["Cena", "extra"]]);
    assert.equal(summary.planned.kcal, 0);
    assert.equal(summary.consumed.kcal, 810);
    assert.equal(summary.deviation, null);
  });

  await t.test("comida pautada a mano sin menú: planned", () => {
    const date = "2026-10-06";
    const dietDay = emptyDay(date, { meals: [meal("Comida", [planned("Pollo", 200, 100, { consumed: true })])] });
    const summary = summarizeDay({ date, today: TODAY, dietDay, phases: [] });
    assert.equal(summary.state, "planned");
    assert.equal(summary.phase, null);
    assert.deepEqual(summary.deviation, { kcal: 0, percentage: 0, withinTolerance: true });
  });

  await t.test("sin fase ni nada pautado: none", () => {
    const summary = summarizeDay({ date: "2026-09-20", today: TODAY, dietDay: null, phases: [phase()] });
    assert.equal(summary.state, "none");
    assert.equal(summary.phase, null);
    assert.deepEqual(summary.menus, []);
    assert.deepEqual(summary.meals, []);
  });

  await t.test("receta: nombre de la receta y kcal de la porción", () => {
    const date = "2026-10-06";
    const recipe = { name: "Lentejas", customProducts: [food("Lenteja", 300, 200)] };
    const dietDay = emptyDay(date, {
      menuName: "Menú A",
      meals: [{ name: "Comida", customProducts: [], customRecipes: [{ recipe, quantity: 100, assignedQuantity: 100, assignedByTrainerId: TRAINER, consumed: false }] }],
    });
    const [item] = summarizeDay({ date, today: TODAY, dietDay, phases: [phase()] }).meals[0].items;
    assert.deepEqual([item.kind, item.name, item.brand, item.status, item.kcal], ["recipe", "Lentejas", null, "unchecked", 300]);
  });
});
