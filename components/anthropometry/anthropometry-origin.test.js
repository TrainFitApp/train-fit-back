const test = require("node:test");
const assert = require("node:assert/strict");
const { pickMeasurements, ownView, ownViews, checkinWritableFields } = require("./anthropometry-origin");

test("el cliente solo ve lo que apuntó él", async (t) => {
  await t.test("sin marca de check-in el documento sale entero", () => {
    assert.deepEqual(ownView({ date: "2026-09-10", weight: 70 }), { date: "2026-09-10", weight: 70 });
  });

  await t.test("se quitan los campos que vinieron de un check-in", () => {
    const doc = { date: "2026-09-10", weight: 70, waist: 82, checkinFields: ["waist"] };
    assert.deepEqual(ownView(doc), { date: "2026-09-10", weight: 70 });
  });

  await t.test("las medidas exclusivas de check-in nunca le salen", () => {
    const doc = { date: "2026-09-10", weight: 70, shoulders: 118, bicepsRelaxedL: 36, muscleMass: 32 };
    assert.deepEqual(ownView(doc), { date: "2026-09-10", weight: 70 });
    assert.equal(ownView({ date: "2026-09-10", fatMass: 14 }), null);
  });

  await t.test("un día solo con datos de check-in desaparece", () => {
    const docs = [
      { date: "2026-09-10", waist: 82, checkinFields: ["waist"] },
      { date: "2026-09-11", weight: 70.4 },
    ];
    assert.deepEqual(ownViews(docs), [{ date: "2026-09-11", weight: 70.4 }]);
  });
});

test("qué puede escribir el cliente", () => {
  assert.deepEqual(
    pickMeasurements({ weight: 70, calf: 38, shoulders: 118, quadL: 58, userId: "x", neck: "38", hip: null, chest: "" }),
    { weight: 70, calf: 38, neck: 38 }
  );
});

test("un check-in no pisa lo que el cliente apuntó ese día", () => {
  const existing = { weight: 70, waist: 80, checkinFields: ["waist"] };
  assert.deepEqual(checkinWritableFields(existing, { weight: 71, waist: 81, hip: 95 }), { waist: 81, hip: 95 });
  assert.deepEqual(checkinWritableFields(null, { weight: 71 }), { weight: 71 });
});
