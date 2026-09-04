const test = require("node:test");
const assert = require("node:assert/strict");
const { pickCurrentPhase } = require("./routine-assignment-schedule");

// Tarea 5bis (2026-09) — adherencia de entrenamiento pasó a mirar SOLO la
// fase en curso (ver client-data-loader.js#loadTrainingWindow y
// roster-service.js#computeCurrentPhaseTraining). pickCurrentPhase es la
// pieza que decide cuál es esa fase a partir de un array ya cargado en
// memoria — el mismo criterio que routine-assignment-dao.js#findCoveringDate
// resuelve con una consulta a Mongo, aquí en JS puro.
test("pickCurrentPhase", async (t) => {
  await t.test("sin fases devuelve null", () => {
    assert.equal(pickCurrentPhase([], "2026-09-03"), null);
  });

  await t.test("una fase futura no cuenta como actual", () => {
    const futura = { startDate: "2026-09-10", createdAt: "2026-09-01" };
    assert.equal(pickCurrentPhase([futura], "2026-09-03"), null);
  });

  await t.test("una sola fase vigente se devuelve tal cual", () => {
    const fase = { startDate: "2026-08-01", createdAt: "2026-08-01" };
    assert.equal(pickCurrentPhase([fase], "2026-09-03"), fase);
  });

  await t.test("entre varias fases pasadas, gana la de startDate más reciente", () => {
    const antigua = { startDate: "2026-07-01", createdAt: "2026-07-01" };
    const reciente = { startDate: "2026-08-15", createdAt: "2026-08-15" };
    const futura = { startDate: "2026-09-10", createdAt: "2026-09-10" };
    assert.equal(pickCurrentPhase([antigua, reciente, futura], "2026-09-03"), reciente);
  });

  // El escenario exacto del bug de borrado: aplicar A y B el mismo día.
  await t.test("mismo startDate: gana la de createdAt más reciente", () => {
    const a = { startDate: "2026-09-03", createdAt: "2026-09-03T09:00:00.000Z" };
    const b = { startDate: "2026-09-03", createdAt: "2026-09-03T10:00:00.000Z" };
    assert.equal(pickCurrentPhase([a, b], "2026-09-03"), b);
    // El orden de llegada no debería importar.
    assert.equal(pickCurrentPhase([b, a], "2026-09-03"), b);
  });

  await t.test("una fase que empieza HOY ya cuenta como vigente", () => {
    const fase = { startDate: "2026-09-03", createdAt: "2026-09-03" };
    assert.equal(pickCurrentPhase([fase], "2026-09-03"), fase);
  });
});
