const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isoDate,
  daysElapsed,
  daysInRange,
  addDaysToIsoDate,
  todayIsoDate,
} = require("./date-util");

// Estas dos funciones se llamaban IGUAL en dos archivos distintos y
// devolvían resultados que difieren en 1. Eso no falla nunca de forma
// visible: solo hace que un denominador salga corrido o que el día 1 de un
// plan sea el 2. La diferencia se fija aquí explícitamente.

test("daysElapsed vs daysInRange", async (t) => {
  await t.test("el mismo día: 0 transcurridos, 1 en el rango", () => {
    assert.equal(daysElapsed("2026-08-23", "2026-08-23"), 0);
    assert.equal(daysInRange("2026-08-23", "2026-08-23"), 1);
  });

  await t.test("un día después: 1 transcurrido, 2 en el rango", () => {
    assert.equal(daysElapsed("2026-08-23", "2026-08-24"), 1);
    assert.equal(daysInRange("2026-08-23", "2026-08-24"), 2);
  });

  await t.test("difieren siempre exactamente en 1", () => {
    for (const [from, to] of [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-27", "2026-03-02"],
      ["2025-12-30", "2026-01-02"],
    ]) {
      assert.equal(daysInRange(from, to) - daysElapsed(from, to), 1, `${from} → ${to}`);
    }
  });

  await t.test("cruza fin de mes y fin de año correctamente", () => {
    assert.equal(daysElapsed("2026-01-31", "2026-02-01"), 1);
    assert.equal(daysElapsed("2025-12-31", "2026-01-01"), 1);
  });

  await t.test("año bisiesto: febrero de 2028 tiene 29 días", () => {
    assert.equal(daysElapsed("2028-02-01", "2028-03-01"), 29);
  });

  await t.test("daysInRange nunca baja de 1, ni con el rango invertido", () => {
    // Un denominador de 0 o negativo produciría porcentajes absurdos.
    assert.equal(daysInRange("2026-08-24", "2026-08-23"), 1);
    assert.ok(daysInRange("2026-08-30", "2026-08-01") >= 1);
  });

  await t.test("daysElapsed SÍ puede ser negativo (es una resta, no un tamaño)", () => {
    assert.equal(daysElapsed("2026-08-24", "2026-08-23"), -1);
  });
});

test("addDaysToIsoDate", async (t) => {
  await t.test("suma y resta días", () => {
    assert.equal(addDaysToIsoDate("2026-08-23", 1), "2026-08-24");
    assert.equal(addDaysToIsoDate("2026-08-23", -1), "2026-08-22");
    assert.equal(addDaysToIsoDate("2026-08-23", 0), "2026-08-23");
  });

  await t.test("cruza meses y años", () => {
    assert.equal(addDaysToIsoDate("2026-01-31", 1), "2026-02-01");
    assert.equal(addDaysToIsoDate("2026-01-01", -1), "2025-12-31");
    assert.equal(addDaysToIsoDate("2026-08-23", 30), "2026-09-22");
  });

  await t.test("es consistente con daysElapsed", () => {
    for (const delta of [1, 7, 28, 90, -14]) {
      assert.equal(daysElapsed("2026-08-23", addDaysToIsoDate("2026-08-23", delta)), delta);
    }
  });
});

test("isoDate / todayIsoDate", async (t) => {
  await t.test("recorta un Date a YYYY-MM-DD", () => {
    assert.equal(isoDate(new Date("2026-08-23T18:45:00.000Z")), "2026-08-23");
  });

  await t.test("es idempotente sobre una cadena que ya lo es", () => {
    assert.equal(isoDate("2026-08-23"), "2026-08-23");
  });

  await t.test("todayIsoDate tiene el formato esperado", () => {
    assert.match(todayIsoDate(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
