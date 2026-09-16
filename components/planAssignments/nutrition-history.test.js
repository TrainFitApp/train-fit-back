const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPhaseEvents, sortEvents, cycleStatus } = require("./nutrition-history");

// Feed del historial de nutrición: si esto se equivoca, el entrenador ve un
// ciclo "cumplido" que no lo fue, o un check-in colgado del ciclo que no era.

const T = "t1";
const seq = (id, startDate, nDays, extra = {}) => ({
  _id: id,
  startDate,
  mode: "sequential",
  days: Array.from({ length: nDays }, (_, i) => ({ dayLabel: `Día ${i + 1}`, meals: [] })),
  ...extra,
});

// Un día con un alimento pautado, marcado o no.
const day = (date, consumed) => ({
  date,
  meals: [{ completed: false, customProducts: [{ assignedByTrainerId: T, consumed, kcal: 100, quantity: 100, product: { kcal: 100 } }], customRecipes: [] }],
});

test("cycleStatus", async (t) => {
  await t.test("en curso mientras no acaba", () => {
    assert.equal(cycleStatus({ end: "2026-09-14", today: "2026-09-14", adherencePct: 10 }), "running");
  });
  await t.test("acabado: umbral 75 %", () => {
    assert.equal(cycleStatus({ end: "2026-09-10", today: "2026-09-14", adherencePct: 75 }), "met");
    assert.equal(cycleStatus({ end: "2026-09-10", today: "2026-09-14", adherencePct: 74 }), "missed");
    assert.equal(cycleStatus({ end: "2026-09-10", today: "2026-09-14", adherencePct: null }), "no_data");
  });
});

test("buildPhaseEvents", async (t) => {
  const head = seq("p1", "2026-09-01", 3, { phaseId: "p1", phaseName: "Definición", phaseFocus: "cut", status: "active" });

  await t.test("fase futura: sin eventos", () => {
    assert.deepEqual(buildPhaseEvents({ head: { ...head, startDate: "2026-10-01" }, cycles: [head], days: [], checkins: [], exceptions: [], today: "2026-09-14" }), []);
  });

  await t.test("inicio de fase + un ciclo por ventana; el actual en curso", () => {
    const events = buildPhaseEvents({ head, cycles: [head], days: [], checkins: [], exceptions: [], today: "2026-09-05" });
    assert.deepEqual(events.map((e) => e.type), ["phase_started", "cycle", "cycle"]);
    const [, c1, c2] = events;
    assert.equal(c1.number, 1);
    assert.equal(c1.end, "2026-09-03");
    assert.equal(c1.status, "no_data");
    assert.equal(c2.number, 2);
    assert.equal(c2.status, "running");
    assert.equal(c2.periodDays, 2); // 4 y 5
  });

  await t.test("adherencia solo con los días de SU ventana", () => {
    const days = [day("2026-09-01", true), day("2026-09-02", true), day("2026-09-03", false), day("2026-09-04", false)];
    const events = buildPhaseEvents({ head, cycles: [head], days, checkins: [], exceptions: [], today: "2026-09-10" });
    const cycles = events.filter((e) => e.type === "cycle");
    assert.equal(cycles[0].adherencePct, 67);
    assert.equal(cycles[0].status, "missed");
    assert.equal(cycles[0].adherenceDays, 3);
    assert.equal(cycles[1].adherencePct, 0);
    assert.equal(cycles[2].adherencePct, null);
  });

  await t.test("check-in y excepción cuelgan del ciclo y además son eventos", () => {
    const checkin = { _id: "r1", respondedAt: new Date("2026-09-02T10:00:00Z"), values: { weight: 80 }, cycle: { phaseId: "p1", number: 1 } };
    const exceptions = [
      { _id: "e1", date: "2026-09-02", action: "skip", mealSlot: null },
      { _id: "e2", date: "2026-08-20", action: "skip", mealSlot: null }, // fuera de la fase
    ];
    const events = buildPhaseEvents({ head, cycles: [head], days: [], checkins: [checkin], exceptions, today: "2026-09-03" });
    const c1 = events.find((e) => e.type === "cycle" && e.number === 1);
    assert.equal(c1.checkin.id, "r1");
    assert.deepEqual(c1.checkin.values, { weight: 80 });
    assert.equal(c1.exceptions.length, 1);
    assert.equal(events.filter((e) => e.type === "checkin").length, 1);
    assert.equal(events.find((e) => e.type === "checkin").number, 1);
    assert.equal(events.filter((e) => e.type === "exception").length, 1);
  });

  await t.test("fase cortada: último ciclo recortado + evento de fin", () => {
    const cut = { ...head, endDate: "2026-09-04", status: "superseded" };
    const events = buildPhaseEvents({ head: cut, cycles: [cut], days: [], checkins: [], exceptions: [], today: "2026-09-14" });
    const cycles = events.filter((e) => e.type === "cycle");
    assert.equal(cycles.length, 2);
    assert.equal(cycles[1].end, "2026-09-04");
    assert.equal(cycles[1].truncated, true);
    assert.notEqual(cycles[1].status, "running");
    const end = events.find((e) => e.type === "phase_ended");
    assert.equal(end.date, "2026-09-04");
    assert.equal(end.status, "superseded");
    assert.equal(end.cyclesCount, 2);
  });

  await t.test("C2 preparado: el head lleva endDate pero la fase sigue abierta", () => {
    const cutHead = { ...head, endDate: "2026-09-03", status: "superseded" };
    const c2 = seq("c2", "2026-09-04", 3, { phaseId: "p1", status: "active", endDate: null });
    const events = buildPhaseEvents({ head: cutHead, cycles: [cutHead, c2], days: [], checkins: [], exceptions: [], today: "2026-09-10" });
    assert.equal(events.filter((e) => e.type === "phase_ended").length, 0);
    const cycles = events.filter((e) => e.type === "cycle");
    assert.equal(cycles.length, 4);
    assert.equal(cycles[3].status, "running");
  });

  await t.test("kcalDelta respecto al ciclo anterior", () => {
    const c2 = seq("c2", "2026-09-04", 3, { phaseId: "p1" });
    const events = buildPhaseEvents({ head, cycles: [head, c2], days: [], checkins: [], exceptions: [], today: "2026-09-05" });
    const cycles = events.filter((e) => e.type === "cycle");
    assert.equal(cycles[0].kcalDelta, null);
    assert.equal(cycles[1].kcalDelta, 0);
    assert.equal(cycles[1].overrideId, "c2");
  });
});

test("sortEvents: reciente primero; a igual fecha, fin > ciclo > check-in > excepción > inicio", () => {
  const sorted = sortEvents([
    { type: "phase_started", date: "2026-09-01" },
    { type: "cycle", date: "2026-09-01", number: 1 },
    { type: "checkin", date: "2026-09-01", number: 1 },
    { type: "cycle", date: "2026-09-04", number: 2 },
    { type: "phase_ended", date: "2026-09-04" },
  ]);
  assert.deepEqual(
    sorted.map((e) => `${e.date}:${e.type}`),
    ["2026-09-04:phase_ended", "2026-09-04:cycle", "2026-09-01:cycle", "2026-09-01:checkin", "2026-09-01:phase_started"]
  );
});
