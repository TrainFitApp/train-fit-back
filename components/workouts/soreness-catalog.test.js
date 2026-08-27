const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SORENESS_MUSCLES,
  SORENESS_ANCHORS,
  sanitizeSoreness,
} = require("./soreness-catalog");

// sanitizeSoreness es lo único que separa lo que manda el cliente de lo que
// se guarda: modifyWorkout escribe con $set y sin runValidators, así que si
// esto deja pasar basura, la basura queda en la base de datos.

test("sanitizeSoreness", async (t) => {
  await t.test("conserva los grupos válidos con su nivel", () => {
    const result = sanitizeSoreness([
      { muscle: "Cuádriceps", level: 4 },
      { muscle: "Glúteo", level: 2 },
    ]);
    assert.deepEqual(result, [
      { muscle: "Glúteo", level: 2 },
      { muscle: "Cuádriceps", level: 4 },
    ]);
  });

  await t.test("devuelve los grupos en el orden del catálogo, no en el de llegada", () => {
    // Así el entrenador lee siempre los músculos en el mismo sitio.
    const result = sanitizeSoreness([
      { muscle: "Gemelo", level: 2 },
      { muscle: "Pectoral", level: 3 },
    ]);
    assert.deepEqual(
      result.map((r) => r.muscle),
      ["Pectoral", "Gemelo"]
    );
  });

  await t.test("descarta el nivel 1: 'no me duele' de 16 grupos es ruido", () => {
    assert.deepEqual(sanitizeSoreness([{ muscle: "Pectoral", level: 1 }]), []);
  });

  await t.test("descarta músculos que no están en el catálogo", () => {
    assert.deepEqual(sanitizeSoreness([{ muscle: "Deltoides poterior", level: 3 }]), []);
    assert.deepEqual(sanitizeSoreness([{ muscle: "", level: 3 }]), []);
    assert.deepEqual(sanitizeSoreness([{ level: 3 }]), []);
  });

  await t.test("descarta niveles fuera de rango o no enteros", () => {
    for (const level of [0, 6, -1, 2.5, "mucho", null, undefined, NaN]) {
      assert.deepEqual(
        sanitizeSoreness([{ muscle: "Pectoral", level }]),
        [],
        `nivel aceptado indebidamente: ${level}`
      );
    }
  });

  await t.test("un músculo repetido se queda con su último valor, no con dos filas", () => {
    const result = sanitizeSoreness([
      { muscle: "Pectoral", level: 2 },
      { muscle: "Pectoral", level: 5 },
    ]);
    assert.deepEqual(result, [{ muscle: "Pectoral", level: 5 }]);
  });

  await t.test("entradas no válidas devuelven un array vacío, nunca revientan", () => {
    assert.deepEqual(sanitizeSoreness(null), []);
    assert.deepEqual(sanitizeSoreness(undefined), []);
    assert.deepEqual(sanitizeSoreness("Pectoral"), []);
    assert.deepEqual(sanitizeSoreness([null, undefined, 3]), []);
  });

  await t.test("acepta el nivel máximo que anuncian las anclas", () => {
    const max = SORENESS_ANCHORS.length;
    assert.deepEqual(sanitizeSoreness([{ muscle: "Pectoral", level: max }]), [
      { muscle: "Pectoral", level: max },
    ]);
  });
});

test("catálogo de agujetas", async (t) => {
  await t.test("16 grupos, sin repetidos ni vacíos", () => {
    assert.equal(SORENESS_MUSCLES.length, 16);
    assert.equal(new Set(SORENESS_MUSCLES).size, 16);
    for (const muscle of SORENESS_MUSCLES) {
      assert.ok(muscle.trim().length > 0);
    }
  });

  await t.test("5 niveles con frase, sin repetidos ni vacías", () => {
    assert.equal(SORENESS_ANCHORS.length, 5);
    assert.equal(new Set(SORENESS_ANCHORS).size, 5);
    for (const anchor of SORENESS_ANCHORS) {
      assert.ok(anchor.trim().length > 0);
    }
  });
});

// Mismo riesgo que el catálogo de check-ins: vive dos veces y se sincroniza
// a mano. Si el front ofrece un músculo que el backend no conoce, el cliente
// lo marca y el dato se descarta en silencio.
test("el catálogo de agujetas del front es idéntico al del backend", async (t) => {
  const MIRROR = path.join(
    __dirname,
    "../../../train-fit-front/packages/shared-core/src/app/core/constants/soreness.ts"
  );

  await t.test("mismos músculos y mismas anclas", (ctx) => {
    if (!fs.existsSync(MIRROR)) return ctx.skip("no hay repo de front al lado");

    const source = fs.readFileSync(MIRROR, "utf8");

    const extract = (name) => {
      const start = source.indexOf(`export const ${name}: string[] = [`);
      assert.ok(start >= 0, `no se encuentra ${name} en el espejo`);
      const open = source.indexOf("[", start);
      const close = source.indexOf("];", open);
      assert.ok(close > open, `${name} sin cierre`);
      // eslint-disable-next-line no-new-func
      return new Function(`return ${source.slice(open, close + 1)}`)();
    };

    assert.deepEqual(extract("SORENESS_MUSCLES"), SORENESS_MUSCLES);
    assert.deepEqual(extract("SORENESS_ANCHORS"), SORENESS_ANCHORS);
  });
});
