const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPhaseEvents, sortEvents } = require("./nutrition-history");
const { buildWeeks } = require("./week-window");

const TODAY = "2026-09-26";
const SKIPPED = ["2026-09-24", "2026-09-18", "2026-09-10", "2026-09-03"];

function phase(id, name, startDate, endDate) {
  const head = { _id: id, phaseName: name, startDate, endDate, status: endDate ? "superseded" : "active" };
  const weeks = buildWeeks(startDate, endDate, TODAY);
  return buildPhaseEvents({ head, members: [head], weeks, days: [], skippedDates: SKIPPED, today: TODAY });
}

const feed = () =>
  sortEvents([
    ...phase("A", "Volumen", "2026-08-12", "2026-09-08"),
    ...phase("B", "Definición", "2026-09-09", "2026-09-16"),
    ...phase("C", "Mantenimiento", "2026-09-17", null),
  ]);

test("el feed sale de la fecha más reciente a la más antigua", () => {
  const dates = feed().map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("a igual fecha: fin de fase, semana, inicio de fase", () => {
  const events = feed();
  const onDay = (date) => events.filter((e) => e.date === date).map((e) => e.type);
  assert.deepEqual(onDay("2026-09-17"), ["week", "phase_started"]);
  assert.deepEqual(onDay("2026-09-09"), ["week", "phase_started"]);
  assert.deepEqual(onDay("2026-09-08"), ["phase_ended"]);
});

test("solo hay eventos de fase y semana: ni check-ins ni días saltados sueltos", () => {
  const types = new Set(feed().map((e) => e.type));
  assert.deepEqual([...types].sort(), ["phase_ended", "phase_started", "week"]);
});

test("los días saltados cuelgan de su semana", () => {
  const weeks = feed().filter((e) => e.type === "week");
  const byStart = Object.fromEntries(weeks.map((w) => [w.start, w.skippedDays]));
  assert.deepEqual(byStart["2026-09-21"], ["2026-09-24"]);
  assert.deepEqual(byStart["2026-09-17"], ["2026-09-18"]);
  assert.deepEqual(byStart["2026-09-09"], ["2026-09-10"]);
  assert.ok(weeks.every((w) => !("checkin" in w) && !("checkins" in w)));
});

test("la semana lleva kcal y macros pautados", () => {
  const week = feed().find((e) => e.type === "week");
  assert.deepEqual(Object.keys(week.profile).sort(), ["carbs", "fat", "kcal", "protein"]);
});
