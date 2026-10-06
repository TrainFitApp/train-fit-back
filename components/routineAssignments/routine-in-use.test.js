const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRoutineInUse } = require("./routine-in-use");

// La rutina en uso se calcula: manda lo más reciente entre la elección
// explícita (tableInUseAt) y la entrada en vigor de la fase que cubre hoy
// (inicio de su día en la zona del cliente, o su creación si es posterior).

const TZ = "Europe/Madrid";
const phase = (tableId, startDate, createdAt) => ({ _id: `p-${tableId}`, tableId, startDate, createdAt: new Date(createdAt) });
const user = (fields = {}) => ({ timezone: TZ, ...fields });

test("sin elección ni fase, nada en uso", () => {
  assert.deepEqual(resolveRoutineInUse(user(), null), { tableInUse: null, workoutInUse: null, phase: null });
});

test("sin elección, la fase que cubre hoy", () => {
  const covering = phase("coach", "2026-10-01", "2026-09-28T10:00:00Z");
  assert.deepEqual(resolveRoutineInUse(user(), covering), { tableInUse: "coach", workoutInUse: null, phase: covering });
});

test("una elección posterior a la entrada en vigor de la fase manda", () => {
  const covering = phase("coach", "2026-10-01", "2026-09-28T10:00:00Z");
  const chosen = user({ tableInUse: "mia", tableInUseAt: new Date("2026-10-02T08:00:00Z") });
  assert.equal(resolveRoutineInUse(chosen, covering).tableInUse, "mia");
});

test("la fase entra en vigor al empezar SU día en la zona del cliente", () => {
  const covering = phase("coach", "2026-10-05", "2026-09-28T10:00:00Z");
  // 2026-10-05 00:00 en Madrid = 2026-10-04 22:00 UTC.
  const before = user({ tableInUse: "mia", tableInUseAt: new Date("2026-10-04T21:59:00Z") });
  const after = user({ tableInUse: "mia", tableInUseAt: new Date("2026-10-04T22:01:00Z") });
  assert.equal(resolveRoutineInUse(before, covering).tableInUse, "coach");
  assert.equal(resolveRoutineInUse(after, covering).tableInUse, "mia");
});

test("una fase creada con fecha pasada entra en vigor al crearse: gana a una elección anterior", () => {
  const covering = phase("coach", "2026-09-20", "2026-10-03T12:00:00Z");
  const chosen = user({ tableInUse: "mia", tableInUseAt: new Date("2026-10-01T08:00:00Z") });
  assert.equal(resolveRoutineInUse(chosen, covering).tableInUse, "coach");
});

test("la sesión a medias solo vale si se puso después de que su rutina entrara en vigor", () => {
  const covering = phase("coach", "2026-10-01", "2026-09-28T10:00:00Z");
  const stale = user({ workoutInUse: "w1", workoutInUseAt: new Date("2026-09-29T10:00:00Z") });
  const fresh = user({ workoutInUse: "w2", workoutInUseAt: new Date("2026-10-02T10:00:00Z") });
  assert.equal(resolveRoutineInUse(stale, covering).workoutInUse, null);
  assert.equal(resolveRoutineInUse(fresh, covering).workoutInUse, "w2");

  const chosen = user({
    tableInUse: "mia",
    tableInUseAt: new Date("2026-10-02T08:00:00Z"),
    workoutInUse: "w3",
    workoutInUseAt: new Date("2026-10-02T09:00:00Z"),
  });
  assert.equal(resolveRoutineInUse(chosen, null).workoutInUse, "w3");
  assert.equal(resolveRoutineInUse({ ...chosen, workoutInUseAt: new Date("2026-10-01T09:00:00Z") }, null).workoutInUse, null);
});
