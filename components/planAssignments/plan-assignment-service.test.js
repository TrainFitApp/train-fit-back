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

  // Ciclos por contenido: con el siguiente ciclo preparado, el ciclo en
  // curso lleva endDate y el preparado empieza en el futuro — los dos
  // bloqueaban empezar otra fase HOY, justo lo que el 409 decía que hiciera.
  await t.test("los ciclos de la fase que rige no bloquean empezar HOY", () => {
    const enCursoCortado = { phaseId: "f1", startDate: "2026-09-13", endDate: "2026-09-15" };
    const preparado = { phaseId: "f1", startDate: "2026-09-16", endDate: null };
    assert.equal(blocksNewPhase(enCursoCortado, HOY, HOY, "f1"), false);
    assert.equal(blocksNewPhase(preparado, HOY, HOY, "f1"), false);
  });

  await t.test("pero sí bloquean programar una fase FUTURA encima", () => {
    const preparado = { phaseId: "f1", startDate: "2026-09-16", endDate: null };
    assert.equal(blocksNewPhase(preparado, "2026-09-20", HOY, "f1"), true);
  });

  await t.test("los ciclos de OTRA fase siguen bloqueando aunque haya una que rige", () => {
    const otra = { phaseId: "f2", startDate: "2026-09-16", endDate: null };
    assert.equal(blocksNewPhase(otra, HOY, HOY, "f1"), true);
  });
});
