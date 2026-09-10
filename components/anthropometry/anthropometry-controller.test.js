const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MEASUREMENT_FIELD_NAMES,
  pickMeasurements,
  implausibleField,
} = require("./anthropometry-controller");
const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

// Este controller aceptaba una lista de campos escrita a mano que se quedó
// atrás cuando el catálogo creció: el cliente rellenaba masa grasa o bíceps
// izquierdo, veía "guardado", y la medida no se escribía en ninguna parte.
// Un fallo así no rompe nada visible — por eso hay que fijarlo con un test.

test("campos que acepta antropometría", async (t) => {
  await t.test("acepta TODOS los campos corporales del catálogo", () => {
    const delCatalogo = CHECKIN_FIELDS.filter((f) => f.storage === "anthropometry").map(
      (f) => f.anthropometryField
    );
    assert.deepEqual([...MEASUREMENT_FIELD_NAMES].sort(), [...delCatalogo].sort());
  });

  await t.test("incluye los campos con lateralidad y los de composición", () => {
    for (const name of [
      "muscleMass",
      "fatMass",
      "shoulders",
      "quadL",
      "quadR",
      "bicepsRelaxedL",
      "bicepsContractedR",
      "calfL",
      "ankleR",
    ]) {
      assert.ok(MEASUREMENT_FIELD_NAMES.includes(name), `falta ${name}`);
    }
  });

  await t.test("no escribe los campos deprecados sin lateralidad", () => {
    for (const name of ["bicepsRelaxed", "bicepsContracted", "calf"]) {
      assert.ok(!MEASUREMENT_FIELD_NAMES.includes(name), `${name} está deprecado`);
    }
  });
});

test("selección de medidas del cuerpo de la petición", async (t) => {
  await t.test("conserva todo lo que llega del formulario", () => {
    const body = { date: "2026-09-09", weight: 78.4, fatMass: 14.2, quadL: 58 };
    assert.deepEqual(pickMeasurements(body), { weight: 78.4, fatMass: 14.2, quadL: 58 });
  });

  await t.test("ignora lo que no es una medida", () => {
    const picked = pickMeasurements({ userId: "otro", notes: "hola", weight: 70 });
    assert.deepEqual(picked, { weight: 70 });
  });

  // Un campo ausente NO se pone a null: escribiría sobre lo que un check-in
  // pudo dejar ese mismo día en el mismo documento.
  await t.test("un campo ausente no viaja como null", () => {
    const picked = pickMeasurements({ weight: 70, waist: null, hip: undefined });
    assert.deepEqual(picked, { weight: 70 });
  });
});

test("plausibilidad en la vía del cliente", async (t) => {
  await t.test("deja pasar medidas reales", () => {
    assert.equal(implausibleField({ weight: 78.4, waist: 82, abdomen: 88 }), null);
  });

  // El caso real que originó las cotas: "Ombligo ha bajado 44,0 cm (-35,8%)".
  await t.test("caza el dedo que resbala", () => {
    assert.equal(implausibleField({ abdomen: 44 }), "abdomen");
    assert.equal(implausibleField({ weight: 7 }), "weight");
    assert.equal(implausibleField({ waist: 800 }), "waist");
  });

  await t.test("rechaza lo que no es un número", () => {
    assert.equal(implausibleField({ weight: "mucho" }), "weight");
    assert.equal(implausibleField({ weight: NaN }), "weight");
  });
});
