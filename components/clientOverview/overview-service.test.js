const test = require("node:test");
const assert = require("node:assert/strict");
const { latestWellbeing, taskOrder, intakeDetail, observations } = require("./overview-service");
const Anthropometry = require("../anthropometry/anthropometry-dao");
const CheckinRequest = require("../trainerCheckins/checkin-request-schema");

test("historical observations use the client's closing civil date on both sides of UTC midnight", async (t) => {
  t.mock.method(Anthropometry, "getAllAnthropometriesByUserId", async () => [
    { _id: "after", date: "2026-09-12", weight: 78 },
    { _id: "closing", date: "2026-09-11", weight: 79 },
    { _id: "previous", date: "2026-09-10", weight: 80 },
  ]);
  t.mock.method(CheckinRequest, "find", () => ({ sort() { return this; }, select() { return this; }, async lean() { return []; } }));
  const stage = { startedAt: new Date("2026-09-01T00:00:00Z"), endedAt: new Date("2026-09-10T22:30:00Z"), version: 0 };

  // El cierre ya es el 11 en Madrid: no debe perder el pesaje civil de ese día.
  const madrid = await observations("trainer", "client", stage, "Europe/Madrid");
  assert.deepEqual(madrid.entries.map((entry) => entry.date), ["2026-09-11", "2026-09-10"]);

  // A las 03:30Z del 11 todavía es el 10 en Nueva York: el pesaje del 11 queda fuera.
  const newYork = await observations("trainer", "client", { ...stage, endedAt: new Date("2026-09-11T03:30:00Z") }, "America/New_York");
  assert.deepEqual(newYork.entries.map((entry) => entry.date), ["2026-09-10"]);
  assert.notEqual(madrid.digest, newYork.digest);
});

test("latest wellbeing uses most recent response per field, including zero, with its date", () => {
  const latest = latestWellbeing([
    { _id: "old", status: "reviewed", respondedAt: "2026-09-01T10:00:00Z", values: { sleep_hours: 8, general_fatigue: 5, comment: "Semana difícil" } },
    { _id: "new", status: "responded", respondedAt: "2026-09-08T10:00:00Z", values: { sleep_hours: 0, general_fatigue: 1 } },
    { _id: "pending", status: "pending", respondedAt: null, values: { comment: "No enviada" } },
  ]);
  assert.equal(latest.find((v) => v.key === "sleep_hours").value, 0);
  assert.equal(latest.find((v) => v.key === "general_fatigue").value, 1);
  assert.equal(latest.find((v) => v.key === "comment").value, "Semana difícil");
  assert.equal(latest.find((v) => v.key === "comment").recordedAt, "2026-09-01T10:00:00Z");
  assert.equal(latest.find((v) => v.key === "general_fatigue").requestId, "new");
});
test("task urgency sorts due dates first without inventing priority for undated tasks", () => {
  const items = [{ _id: "a", status: "pending", dueDate: null, createdAt: "2026-09-10" }, { _id: "b", status: "done", dueDate: "2026-09-01", createdAt: "2026-09-09" }, { _id: "c", status: "pending", dueDate: "2026-09-08", createdAt: "2026-09-07" }, { _id: "d", status: "pending", dueDate: "2026-09-02", createdAt: "2026-09-01" }];
  assert.deepEqual(items.sort(taskOrder).map((i) => i._id), ["d", "c", "a", "b"]);
});
test("legacy intake retains custom labels and flags non-reconstructable originals", () => {
  const snapshot = { legacy: true, submittedAt: "2026-01-01", questions: [], nutrition: null, answers: { goals: "Fuerza", customAnswers: [{ questionId: "q", label: "Horario de trabajo", value: "Turno de noche" }] }, note: "Última versión disponible" };
  const result = intakeDetail({ intakeSnapshot: snapshot, baselines: [], measurementFields: ["weight"] });
  assert.equal(result.responses.find((r) => r.key === "q").label, "Horario de trabajo");
  assert.deepEqual(result.missingFields, ["weight"]);
  assert.equal(result.legacy, true);
  assert.equal(snapshot.answers.goals, "Fuerza");
});
test("original intake measurements and later complements remain distinct", () => {
  const result = intakeDetail({ intakeSnapshot: { submittedAt: "2026-01-01", questions: [{ key: "weight", label: "Peso", unit: "kg" }], answers: {}, nutrition: {}, measurements: [], missingFields: ["weight"] }, measurementFields: ["weight"], baselines: [{ key: "weight", value: 80, date: "2026-01-05", source: "completion" }] });
  assert.equal(result.responses[0].value, null);
  assert.equal(result.complements[0].date, "2026-01-05");
  assert.deepEqual(result.missingFields, []);
});

test("a measurement reused in the original intake is not a later complement", () => {
  const measurement = { field: "weight", value: 80, date: "2026-01-01", confirmedExisting: true };
  const baseline = { key: "weight", value: 80, date: measurement.date, source: "existing", sourceId: "original" };
  const result = intakeDetail({ intakeSnapshot: { answers: {}, measurements: [measurement], questions: [{ key: "weight", label: "Peso" }] }, measurementFields: ["weight"], baselines: [baseline], changes: [] });
  assert.equal(result.responses[0].value, 80);
  assert.deepEqual(result.complements, []);
});

test("a pending field completed with an existing measurement is a complement", () => {
  const weight = { key: "weight", value: 80, date: "2026-01-01", source: "existing" };
  const hip = { key: "hip", value: 99, date: "2026-01-05", source: "existing", sourceId: "later", recordedBy: "client" };
  const result = intakeDetail({ intakeSnapshot: { answers: {}, measurements: [{ field: "weight", value: 80, date: weight.date, confirmedExisting: true }], questions: [{ key: "hip", label: "Cadera" }] }, measurementFields: ["weight", "hip"], baselines: [weight, hip], changes: [{ kind: "baselines", before: [weight], after: [hip], actorId: "client" }] });
  assert.equal(result.responses[0].value, null);
  assert.deepEqual(result.complements, [hip]);
  assert.deepEqual(result.missingFields, []);
});

test("professional reconfirmation with an existing measurement preserves the original answer", () => {
  const original = { field: "weight", value: 80, date: "2026-01-01", confirmedExisting: true };
  const confirmed = { key: "weight", value: 81, date: "2026-01-05", source: "existing", sourceId: "reconfirmed", recordedBy: "trainer" };
  const result = intakeDetail({ intakeSnapshot: { answers: {}, measurements: [original], questions: [{ key: "weight", label: "Peso" }] }, measurementFields: ["weight"], baselines: [confirmed], changes: [{ kind: "baselines", before: [{ key: "weight", value: 80, date: original.date }], after: [confirmed], actorId: "trainer" }] });
  assert.equal(result.responses[0].value, 80);
  assert.equal(result.responses[0].date, "2026-01-01");
  assert.deepEqual(result.complements, [confirmed]);
  assert.deepEqual(result.measurements, [original]);
});
