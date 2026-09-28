const test = require("node:test");
const assert = require("node:assert/strict");
const { prefillWindow, anthropometryPrefill, changedAnthropometryFields } = require("./checkin-prefill");

const quincenal = { startDate: "2026-09-01", frequency: "weekly", interval: 2 };

test("ventana del autorrelleno", async (t) => {
  await t.test("va del día siguiente a la ocurrencia anterior hasta hoy", () => {
    assert.deepEqual(prefillWindow(quincenal, { index: 1, date: "2026-09-15" }, "2026-09-17"), {
      from: "2026-09-02",
      to: "2026-09-17",
    });
  });

  await t.test("la primera ocurrencia retrocede un periodo", () => {
    assert.deepEqual(prefillWindow(quincenal, { index: 0, date: "2026-09-01" }, "2026-09-01"), {
      from: "2026-08-19",
      to: "2026-09-01",
    });
  });

  await t.test("un check-in único mira la última semana", () => {
    const once = { startDate: "2026-09-10", frequency: "once", interval: 1 };
    assert.equal(prefillWindow(once, { index: 0, date: "2026-09-10" }, "2026-09-10").from, "2026-09-04");
  });
});

test("autorrelleno con Anthropometry", async (t) => {
  const window = { from: "2026-09-02", to: "2026-09-17" };
  const medidas = [
    { date: "2026-09-01", weight: 70, waist: 90 },
    { date: "2026-09-08", weight: 71.2, waist: 82 },
    { date: "2026-09-12", weight: 70.8 },
  ];

  await t.test("cada campo toma su último valor dentro de la ventana", () => {
    assert.deepEqual(anthropometryPrefill(["weight", "perimeter_waist", "perimeter_hip"], medidas, window), {
      weight: { value: 70.8, date: "2026-09-12" },
      perimeter_waist: { value: 82, date: "2026-09-08" },
    });
  });

  await t.test("fuera de la ventana no cuenta", () => {
    assert.deepEqual(anthropometryPrefill(["weight"], medidas, { from: "2026-09-13", to: "2026-09-17" }), {});
  });

  await t.test("solo campos de medida, nunca bienestar", () => {
    assert.deepEqual(anthropometryPrefill(["stress_level"], [{ date: "2026-09-10", stress_level: 3 }], window), {});
  });
});

test("qué se escribe en Anthropometry al responder", () => {
  const prefill = { weight: { value: 70.8, date: "2026-09-12" }, perimeter_waist: { value: 82, date: "2026-09-08" } };
  assert.deepEqual(changedAnthropometryFields({ weight: 70.8, perimeter_waist: 81, perimeter_hip: 95 }, prefill), {
    waist: 81,
    hip: 95,
  });
});
