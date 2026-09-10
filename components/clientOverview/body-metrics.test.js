const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBodyMetrics, naturalWeeks, civilToday, validDate, observationFingerprint } = require("./body-metrics");

test("semanas naturales completas cruzan mes, año y cambio de hora sin desplazar fechas", () => {
  assert.deepEqual(naturalWeeks("2026-01-01", 2), [
    { start: "2025-12-22", end: "2025-12-28", partial: false },
    { start: "2025-12-29", end: "2026-01-04", partial: true },
  ]);
  assert.equal(naturalWeeks("2026-03-29", 1)[0].start, "2026-03-23");
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(civilToday("Europe/Madrid", new Date("2026-09-09T23:30:00Z")), "2026-09-10");
  assert.equal(civilToday("America/Los_Angeles", new Date("2026-09-09T23:30:00Z")), "2026-09-09");
});

test("último peso válido en todo el histórico; un perímetro reciente no lo sustituye", () => {
  const result = buildBodyMetrics([
    { _id: "old", date: "2026-01-01", weight: 81 },
    { _id: "new", date: "2026-09-09", waist: 86 },
    { date: "2026-09-08", weight: 0 },
    { date: "2026-09-07", weight: NaN },
    { date: "2026-09-11", weight: 78 },
  ], [], { today: "2026-09-10", highlightedPerimeters: ["waist"] });
  assert.deepEqual(result.weight.last, { value: 81, date: "2026-01-01", sourceId: "old" });
  assert.equal(result.weight.initial, null);
  assert.equal(result.weight.delta, null);
  assert.equal(result.perimeters[0].last.value, 86);
  assert.equal(result.weight.weekly.at(-1).average, null);
});

test("media divide por pesajes disponibles, une ambos meses, cuenta un valor por día", () => {
  const result = buildBodyMetrics([
    { date: "2026-08-31", weight: 80 },
    { date: "2026-09-01", weight: 82 },
    { date: "2026-09-01", weight: 82 },
    { date: "2026-09-02", waist: 86 },
  ], [], { today: "2026-09-03", weeks: 1 });
  assert.deepEqual(result.weight.weekly, [{ start: "2026-08-31", end: "2026-09-06", partial: true, average: 81, count: 2 }]);
});

test("baseline permanece como snapshot y exige revisar fuente corregida o borrada", () => {
  const baseline = { key: "weight", date: "2026-09-01", value: 80, sourceId: "initial" };
  const corrected = buildBodyMetrics([
    { _id: "initial", date: "2026-09-01", weight: 82 },
    { _id: "latest", date: "2026-09-09", weight: 79 },
  ], [baseline], { today: "2026-09-10" }).weight;
  assert.equal(corrected.initial.value, 80);
  assert.equal(corrected.baselineStatus, "source_changed");
  assert.equal(corrected.delta, null);
  assert.equal(buildBodyMetrics([], [baseline], { today: "2026-09-10" }).weight.baselineStatus, "source_missing");
});

test("perímetros conservan fechas independientes y el peso no lleva juicio de valor", () => {
  const body = buildBodyMetrics([
    { _id: "a", date: "2026-09-01", weight: 80, waist: 90 },
    { _id: "b", date: "2026-09-05", waist: 89 },
    { _id: "c", date: "2026-09-09", weight: 81 },
  ], [
    { key: "weight", value: 80, date: "2026-09-01", sourceId: "a" },
    { key: "waist", value: 90, date: "2026-09-01", sourceId: "a" },
  ], { today: "2026-09-10", highlightedPerimeters: ["waist"] });
  assert.equal(body.weight.delta, 1);
  assert.equal(body.perimeters[0].delta, -1);
  assert.equal(body.perimeters[0].last.date, "2026-09-05");
  assert.equal(body.weight.last.date, "2026-09-09");
});

test("la huella detecta correcciones, borrados y altas retrospectivas; ignora orden de consulta", () => {
  const rows = [{ _id: "a", date: "2026-09-01", weight: 80 }, { _id: "b", date: "2026-09-09", weight: 81 }];
  const original = observationFingerprint(rows);
  assert.equal(original, observationFingerprint([...rows].reverse()));
  assert.notEqual(original, observationFingerprint([...rows, { date: "2026-08-10", waist: 90 }]));
  assert.notEqual(original, observationFingerprint([rows[1]]));
  assert.notEqual(original, observationFingerprint([{ ...rows[0], weight: 82 }, rows[1]]));
});
