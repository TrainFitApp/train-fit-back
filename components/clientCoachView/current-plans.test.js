const test = require("node:test");
const assert = require("node:assert/strict");
const { pickTrainingPlan, pickNutritionPlan } = require("./current-plans");

const TODAY = "2026-09-27";

test("rutina: tableInUse manda y toma el inicio de su fase si coincide", () => {
  const plan = pickTrainingPlan({
    tableInUseId: "t1",
    phases: [{ tableId: "t1", startDate: "2026-09-01" }],
    today: TODAY,
  });
  assert.deepEqual(plan, { status: "active", tableId: "t1", startDate: "2026-09-01" });
});

test("rutina: tableInUse sin fase propia sale sin fecha", () => {
  const plan = pickTrainingPlan({
    tableInUseId: "t2",
    phases: [{ tableId: "t1", startDate: "2026-09-01" }],
    today: TODAY,
  });
  assert.deepEqual(plan, { status: "active", tableId: "t2", startDate: null });
});

test("rutina: la rutina en uso de la fase que cubre hoy lleva el inicio de esa fase (la más reciente)", () => {
  const plan = pickTrainingPlan({
    tableInUseId: "cur",
    phases: [
      { tableId: "old", startDate: "2026-08-01" },
      { tableId: "cur", startDate: "2026-09-20" },
      { tableId: "fut", startDate: "2026-10-05" },
    ],
    today: TODAY,
  });
  assert.deepEqual(plan, { status: "active", tableId: "cur", startDate: "2026-09-20" });
});

test("rutina: solo una fase futura sale programada", () => {
  const plan = pickTrainingPlan({
    phases: [{ tableId: "fut", startDate: "2026-10-02" }],
    today: TODAY,
  });
  assert.deepEqual(plan, { status: "scheduled", tableId: "fut", startDate: "2026-10-02" });
});

test("rutina: sin uso ni fases sale la última asignada, ignorando fechas futuras de seeds", () => {
  const plan = pickTrainingPlan({
    phases: [],
    assignedTables: [
      { tableId: "seed", assignedAt: new Date("2069-12-30T00:00:00Z") },
      { tableId: "vieja", assignedAt: new Date("2026-08-01T00:00:00Z") },
      { tableId: "nueva", assignedAt: new Date("2026-09-26T18:00:00Z") },
    ],
    today: TODAY,
    now: new Date("2026-09-27T10:00:00Z"),
  });
  assert.deepEqual(plan, { status: "assigned", tableId: "nueva", startDate: null });
});

test("rutina: una fase programada gana a una tabla solo asignada", () => {
  const plan = pickTrainingPlan({
    phases: [{ tableId: "fut", startDate: "2026-10-02" }],
    assignedTables: [{ tableId: "otra", assignedAt: new Date("2026-09-26T18:00:00Z") }],
    today: TODAY,
  });
  assert.equal(plan.status, "scheduled");
});

test("rutina: nada asignado da null", () => {
  assert.equal(pickTrainingPlan({ phases: [], today: TODAY }), null);
});

test("dieta: la fase que cubre hoy", () => {
  const phases = [
    { _id: "h1", name: "Adaptación", startDate: "2026-07-13", endDate: "2026-08-23" },
    { _id: "h2", name: "Definición", startDate: "2026-08-24", endDate: null },
  ];
  const plan = pickNutritionPlan({ phases, today: TODAY });
  assert.equal(plan.status, "active");
  assert.equal(plan.phase._id, "h2");
});

test("dieta: sin fase hoy sale la próxima programada", () => {
  const phases = [{ _id: "h1", name: "Volumen", startDate: "2026-10-05", endDate: null }];
  const plan = pickNutritionPlan({ phases, today: TODAY });
  assert.equal(plan.status, "scheduled");
  assert.equal(plan.phase._id, "h1");
});

test("dieta: fase terminada y nada más da null", () => {
  const phases = [{ _id: "h1", startDate: "2026-07-01", endDate: "2026-08-01" }];
  assert.equal(pickNutritionPlan({ phases, today: TODAY }), null);
});
