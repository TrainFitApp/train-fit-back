const test = require("node:test");
const assert = require("node:assert/strict");
const { trainingTimeline, nutritionTimeline } = require("./plan-timeline");

const TODAY = "2026-10-09";
const created = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));

test("rutina: la de hoy sale aparte; las programadas en orden y las anteriores de la más reciente a la más antigua", () => {
  const phases = [
    { _id: "a", tableId: "t1", trainerId: "coach", startDate: "2026-08-01", createdAt: created(1) },
    { _id: "b", tableId: "t2", trainerId: "coach", startDate: "2026-09-01", createdAt: created(2) },
    { _id: "c", tableId: "t3", trainerId: "coach", startDate: "2026-10-01", createdAt: created(3) },
    { _id: "e", tableId: "t5", trainerId: "coach", startDate: "2026-12-01", createdAt: created(5) },
    { _id: "d", tableId: "t4", trainerId: "coach", startDate: "2026-11-01", createdAt: created(4) },
  ];
  const timeline = trainingTimeline({ phases, current: { status: "active", tableId: "t3", startDate: "2026-10-01" }, today: TODAY });

  assert.deepEqual(timeline.current, {
    status: "active",
    id: "c",
    tableId: "t3",
    trainerId: "coach",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });
  assert.deepEqual(timeline.upcoming.map((entry) => entry.id), ["d", "e"]);
  assert.equal(timeline.upcoming[1].endDate, null, "la última no tiene fin");
  assert.deepEqual(timeline.past.map((entry) => entry.id), ["b", "a"]);
  assert.equal(timeline.past[0].endDate, "2026-09-30", "acaba la víspera de la siguiente");
});

test("rutina: la de hoy sin fase (asignada o puesta en uso) no tiene fin ni id y no quita ninguna fase", () => {
  const phases = [{ _id: "a", tableId: "t1", trainerId: "coach", startDate: "2026-08-01", createdAt: created(1) }];
  const timeline = trainingTimeline({ phases, current: { status: "assigned", tableId: "t9", startDate: null }, today: TODAY });

  assert.deepEqual(timeline.current, { status: "assigned", id: null, tableId: "t9", trainerId: null, startDate: null, endDate: null });
  assert.deepEqual(timeline.past.map((entry) => entry.id), ["a"]);
});

test("rutina: programada como plan de hoy no se repite en programadas", () => {
  const phases = [{ _id: "f", tableId: "t1", trainerId: "coach", startDate: "2026-10-20", createdAt: created(1) }];
  const timeline = trainingTimeline({ phases, current: { status: "scheduled", tableId: "t1", startDate: "2026-10-20" }, today: TODAY });

  assert.equal(timeline.current.id, "f");
  assert.deepEqual(timeline.upcoming, []);
  assert.deepEqual(timeline.past, []);
});

test("rutina: una fase sustituida el mismo día en que empezaba no llegó a regir y no sale", () => {
  const phases = [
    { _id: "old", tableId: "t1", trainerId: "coach", startDate: "2026-09-01", createdAt: created(1) },
    { _id: "new", tableId: "t2", trainerId: "coach", startDate: "2026-09-01", createdAt: created(2) },
  ];
  const timeline = trainingTimeline({ phases, current: null, today: TODAY });

  assert.equal(timeline.current, null);
  assert.deepEqual(timeline.past.map((entry) => entry.id), ["new"]);
});

test("dieta: fin real, kcal de su objetivo y la de hoy fuera de las listas", () => {
  const phases = [
    { _id: "p1", name: "Volumen", trainerId: "coach", startDate: "2026-07-01", endDate: "2026-08-31", target: { kcal: 2800.4 }, createdAt: created(1) },
    { _id: "p2", name: "Definición", trainerId: "coach", startDate: "2026-09-01", endDate: null, target: { kcal: 2100 }, createdAt: created(2) },
    { _id: "p3", name: "Mantenimiento", trainerId: "coach", startDate: "2026-11-01", endDate: null, createdAt: created(3) },
  ];
  const timeline = nutritionTimeline({ phases, current: { status: "active", phase: phases[1] }, today: TODAY });

  assert.deepEqual(timeline.current, {
    status: "active",
    id: "p2",
    name: "Definición",
    trainerId: "coach",
    startDate: "2026-09-01",
    endDate: null,
    kcal: 2100,
  });
  assert.deepEqual(timeline.upcoming.map((entry) => [entry.id, entry.kcal]), [["p3", null]]);
  assert.deepEqual(timeline.past.map((entry) => [entry.id, entry.endDate, entry.kcal]), [["p1", "2026-08-31", 2800]]);
});

test("dieta: sin plan de hoy (fase de un profesional que ya no está) la fase vigente queda entre las anteriores", () => {
  const phases = [{ _id: "p1", name: "Volumen", trainerId: "former", startDate: "2026-09-01", endDate: null, createdAt: created(1) }];
  const timeline = nutritionTimeline({ phases, current: null, today: TODAY });

  assert.equal(timeline.current, null);
  assert.deepEqual(timeline.past.map((entry) => entry.id), ["p1"]);
});
