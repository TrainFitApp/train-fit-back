const test = require("node:test");
const assert = require("node:assert/strict");
const { blocksNewPhase } = require("./plan-assignment-service");

// Antes de esto no había ninguna validación: se podían programar dos fases
// sobre los mismos días y el cliente quedaba con dos planes rigiendo a la
// vez. El matiz está en que solapar NO siempre es un error — cambiarle el
// plan a alguien "a partir de hoy" solapa por definición con el que está
// haciendo, y es el flujo normal.
test("blocksNewPhase", async (t) => {
  await t.test("una fase abierta que ya venía corriendo se deja sustituir", () => {
    const enCurso = { startDate: "2026-08-01", endDate: null };
    assert.equal(blocksNewPhase(enCurso, "2026-09-01"), false);
  });

  await t.test("empezar el mismo día en que arrancó la abierta también la sustituye", () => {
    const enCurso = { startDate: "2026-09-01", endDate: null };
    assert.equal(blocksNewPhase(enCurso, "2026-09-01"), false);
  });

  await t.test("una fase con fechas cerradas SÍ bloquea", () => {
    const cerrada = { startDate: "2026-09-01", endDate: "2026-09-30" };
    assert.equal(blocksNewPhase(cerrada, "2026-09-15"), true);
  });

  // El caso que rompía el encadenado: programas una tercera fase con una
  // fecha anterior a la segunda que ya tenías puesta.
  await t.test("una fase abierta que empieza MÁS ADELANTE bloquea", () => {
    const futura = { startDate: "2026-10-01", endDate: null };
    assert.equal(blocksNewPhase(futura, "2026-09-15"), true);
  });
});
