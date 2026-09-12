const test = require("node:test");
const assert = require("node:assert/strict");
const { blocksNewPhase } = require("./plan-assignment-service");

// Antes de esto no había ninguna validación: se podían programar dos fases
// sobre los mismos días y el cliente quedaba con dos planes rigiendo a la
// vez. El matiz está en que solapar NO siempre es un error — cambiarle el
// plan a alguien "a partir de hoy" solapa por definición con el que está
// haciendo, y es el flujo normal.
test("blocksNewPhase", async (t) => {
  const HOY = "2026-09-15";

  await t.test("una fase abierta que ya venía corriendo se deja sustituir HOY", () => {
    const enCurso = { startDate: "2026-08-01", endDate: null };
    assert.equal(blocksNewPhase(enCurso, HOY, HOY), false);
  });

  await t.test("empezar el mismo día en que arrancó la abierta también la sustituye", () => {
    const enCurso = { startDate: HOY, endDate: null };
    assert.equal(blocksNewPhase(enCurso, HOY, HOY), false);
  });

  await t.test("una fase con fin REAL ya estampado SÍ bloquea", () => {
    const cortada = { startDate: "2026-09-01", endDate: "2026-09-30" };
    assert.equal(blocksNewPhase(cortada, HOY, HOY), true);
  });

  // El caso que rompía el encadenado: programas una tercera fase con una
  // fecha anterior a la segunda que ya tenías puesta.
  await t.test("una fase abierta que empieza MÁS ADELANTE bloquea", () => {
    const futura = { startDate: "2026-10-01", endDate: null };
    assert.equal(blocksNewPhase(futura, HOY, HOY), true);
  });

  // 2026-09 — la duración pasó a ser estimación: no cierra la fase, pero sí
  // reserva el tramo. Cambiar de plan "a partir de ya" sigue siendo legal;
  // colocar una fase FUTURA dentro de ese tramo, no.
  await t.test("programar una fase futura dentro de la estimación bloquea", () => {
    const enCurso = { startDate: "2026-09-01", endDate: null, estimatedEndDate: "2026-11-26" };
    assert.equal(blocksNewPhase(enCurso, "2026-11-01", HOY), true);
  });

  await t.test("pero empezar HOY encima de esa misma fase la corta", () => {
    const enCurso = { startDate: "2026-09-01", endDate: null, estimatedEndDate: "2026-11-26" };
    assert.equal(blocksNewPhase(enCurso, HOY, HOY), false);
  });

  await t.test("una fase abierta sin estimación tampoco admite programarle una por delante", () => {
    const sinEstimacion = { startDate: "2026-09-01", endDate: null, estimatedEndDate: null };
    assert.equal(blocksNewPhase(sinEstimacion, "2026-10-20", HOY), true);
  });

  await t.test("una fecha pasada sobre la fase en curso se sigue admitiendo", () => {
    const enCurso = { startDate: "2026-09-01", endDate: null, estimatedEndDate: "2026-11-26" };
    assert.equal(blocksNewPhase(enCurso, "2026-09-10", HOY), false);
  });
});
