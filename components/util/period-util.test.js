const test = require("node:test");
const assert = require("node:assert/strict");
const { addDaysToIsoDate, computeEndDate } = require("./period-util");

// Extraída de plan-assignment-service.js (nutrición) para no tener la
// lógica de "hasta cuándo aplica un plan" duplicada inline en el servicio.
// Una regresión aquí calcula mal la fecha de fin de cualquier PlanAssignment.
test("addDaysToIsoDate", async (t) => {
  await t.test("suma días dentro del mismo mes", () => {
    assert.equal(addDaysToIsoDate("2026-03-01", 5), "2026-03-06");
  });

  await t.test("cruza fin de mes", () => {
    assert.equal(addDaysToIsoDate("2026-01-30", 3), "2026-02-02");
  });

  await t.test("cruza fin de año", () => {
    assert.equal(addDaysToIsoDate("2026-12-30", 3), "2027-01-02");
  });

  await t.test("respeta año bisiesto (2028 es bisiesto)", () => {
    assert.equal(addDaysToIsoDate("2028-02-28", 1), "2028-02-29");
  });

  await t.test("delta 0 devuelve la misma fecha", () => {
    assert.equal(addDaysToIsoDate("2026-06-15", 0), "2026-06-15");
  });
});

test("computeEndDate", async (t) => {
  await t.test("indefinite -> null, sin importar el resto de campos", () => {
    assert.equal(computeEndDate("2026-01-01", "indefinite"), null);
    assert.equal(
      computeEndDate("2026-01-01", "indefinite", { fixedEndDate: "2026-02-01" }),
      null
    );
  });

  await t.test("fixedDate -> devuelve fixedEndDate tal cual", () => {
    assert.equal(
      computeEndDate("2026-01-01", "fixedDate", { fixedEndDate: "2026-03-15" }),
      "2026-03-15"
    );
  });

  await t.test("duration en semanas: inclusive (2 semanas = 14 días, el último incluido)", () => {
    assert.equal(
      computeEndDate("2026-08-08", "duration", { durationValue: 2, durationUnit: "weeks" }),
      "2026-08-21"
    );
  });

  await t.test("duration en días: inclusive (5 días desde el inicio, el último incluido)", () => {
    assert.equal(
      computeEndDate("2026-08-08", "duration", { durationValue: 5, durationUnit: "days" }),
      "2026-08-12"
    );
  });

  await t.test("duration de 1 día -> empieza y termina el mismo día", () => {
    assert.equal(
      computeEndDate("2026-08-08", "duration", { durationValue: 1, durationUnit: "days" }),
      "2026-08-08"
    );
  });

  await t.test("endMode desconocido lanza (nunca debe llegar aquí — validado antes en el controller)", () => {
    assert.throws(() => computeEndDate("2026-01-01", "weird-mode"), /endMode desconocido/);
  });
});
