const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CHECKIN_FIELDS,
  isPlausibleValue,
  isPlausibleAnthropometry,
  isPlausibleAnthropometryChange,
  CHECKIN_FIELDS_BY_KEY,
  scaleLevelsFor,
  DEFAULT_SCALE_LEVELS,
} = require("./checkin-field-catalog");

// Este catálogo es DATOS, y los errores de datos no fallan: se publican.
// Una escala con cuatro anclas en vez de cinco, un ancla vacía o un texto
// que va al revés que su etiqueta no rompen nada — simplemente le llegan al
// cliente, que responde otra cosa de la que el entrenador cree leer.

test("catálogo de check-in", async (t) => {
  await t.test("no hay claves repetidas", () => {
    const keys = CHECKIN_FIELDS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  await t.test("toda escala del catálogo tiene anclas", () => {
    const sinAnclas = CHECKIN_FIELDS.filter(
      (f) => f.type === "scale_1_5" && !f.anchors?.length
    ).map((f) => f.key);
    assert.deepEqual(sinAnclas, [], `escalas sin anclas: ${sinAnclas.join(", ")}`);
  });

  await t.test("ningún ancla está vacía ni repetida dentro de su campo", () => {
    for (const field of CHECKIN_FIELDS) {
      if (!field.anchors) continue;
      for (const anchor of field.anchors) {
        assert.equal(typeof anchor, "string", `${field.key}: ancla no es texto`);
        assert.ok(anchor.trim().length > 0, `${field.key}: ancla vacía`);
      }
      assert.equal(
        new Set(field.anchors).size,
        field.anchors.length,
        `${field.key}: anclas repetidas`
      );
    }
  });

  await t.test("una escala necesita al menos dos niveles para significar algo", () => {
    for (const field of CHECKIN_FIELDS) {
      if (!field.anchors) continue;
      assert.ok(field.anchors.length >= 2, `${field.key}: ${field.anchors.length} nivel(es)`);
    }
  });

  await t.test("todas las escalas son de 5 niveles menos el color de orina, que tiene 8", () => {
    for (const field of CHECKIN_FIELDS) {
      if (field.type !== "scale_1_5") continue;
      const expected = field.key === "urine_color" ? 8 : 5;
      assert.equal(scaleLevelsFor(field), expected, `${field.key}`);
    }
  });

  await t.test("scaleLevelsFor cae a 5 cuando no hay anclas (preguntas propias del coach)", () => {
    assert.equal(scaleLevelsFor({}), DEFAULT_SCALE_LEVELS);
    assert.equal(scaleLevelsFor(null), DEFAULT_SCALE_LEVELS);
    assert.equal(scaleLevelsFor({ anchors: [] }), DEFAULT_SCALE_LEVELS);
  });

  await t.test("toda medida numérica del cuerpo explica cómo tomarse", () => {
    // Sin la instrucción, dos medidas de dos semanas distintas no son
    // comparables — y la app las restaría igualmente.
    const sinInstruccion = CHECKIN_FIELDS.filter(
      (f) => f.storage === "anthropometry" && !f.hint
    ).map((f) => f.key);
    assert.deepEqual(sinInstruccion, [], `sin hint: ${sinInstruccion.join(", ")}`);
  });

  await t.test("urine_color es un campo aparte, no una redefinición de hydration_level", () => {
    // Cambiar hydration_level de 5 a 8 niveles habría reinterpretado en
    // silencio todo el histórico ya guardado.
    assert.equal(scaleLevelsFor(CHECKIN_FIELDS_BY_KEY.get("hydration_level")), 5);
    assert.ok(CHECKIN_FIELDS_BY_KEY.has("urine_color"));
  });
});

// El catálogo vive DOS veces: aquí y en el front (shared-core), sincronizados
// a mano. Es la clase de duplicación que se desincroniza a la primera prisa,
// y cuando pasa el cliente ve un campo que el backend rechaza — o al revés.
test("el catálogo del front es idéntico al del backend", async (t) => {
  const MIRROR = path.join(
    __dirname,
    "../../../train-fit-front/packages/shared-core/src/app/core/constants/checkin-fields.ts"
  );

  await t.test("mismas claves, etiquetas, tipos, anclas e instrucciones", (ctx) => {
    if (!fs.existsSync(MIRROR)) {
      // El backend se despliega solo; en ese caso no hay espejo que
      // comparar y la prueba no aplica en vez de fallar en falso.
      return ctx.skip("no hay repo de front al lado");
    }

    const source = fs.readFileSync(MIRROR, "utf8");
    const start = source.indexOf("export const CHECKIN_FIELDS: CheckinField[] = [");
    const end = source.indexOf("\nexport const CHECKIN_FIELD_KEYS");
    assert.ok(start >= 0 && end > start, "no se encuentra el array en el espejo");

    // Se evalúa el literal del front como JS: es un array de objetos sin
    // nada de TypeScript dentro salvo la anotación de tipo del principio,
    // que se recorta. Compararlo así (y no con una expresión regular por
    // campo) es lo que hace que la prueba detecte CUALQUIER divergencia.
    const literal = source
      .slice(start, end)
      .replace("export const CHECKIN_FIELDS: CheckinField[] =", "");
    // eslint-disable-next-line no-new-func
    const mirrored = new Function(`return ${literal.trim().replace(/;$/, "")}`)();

    assert.equal(mirrored.length, CHECKIN_FIELDS.length, "distinto número de campos");
    assert.deepEqual(
      mirrored,
      CHECKIN_FIELDS,
      "el catálogo del front y el del backend han divergido"
    );
  });
});

// El caso que originó todo esto: a un cliente le llegó la alerta "Ombligo de
// Santiago ha bajado 44,0 cm (-35,8%)". Nadie pierde 44 cm de ombligo. Era
// una errata al teclear, y el motor de señales se la creyó y montó el relato
// entero. Una alerta absurda no cuesta una alerta: cuesta la confianza en
// todas las demás.
test("cotas de plausibilidad", async (t) => {
  await t.test("un ombligo de 44 cm no es un adulto; uno de 84 sí", () => {
    assert.equal(isPlausibleAnthropometry("abdomen", 44), false);
    assert.equal(isPlausibleAnthropometry("abdomen", 84), true);
  });

  await t.test("toda medida corporal tiene cotas", () => {
    const sinCotas = CHECKIN_FIELDS.filter(
      (f) => f.storage === "anthropometry" && (f.min === undefined || f.max === undefined)
    ).map((f) => f.key);
    assert.deepEqual(sinCotas, [], `sin cotas: ${sinCotas.join(", ")}`);
  });

  await t.test("el mínimo es menor que el máximo en todos los campos", () => {
    for (const field of CHECKIN_FIELDS) {
      if (field.min === undefined || field.max === undefined) continue;
      assert.ok(field.min < field.max, `${field.key}: ${field.min} >= ${field.max}`);
    }
  });

  await t.test("las cotas son ANCHAS: no dejan fuera a personas reales", () => {
    // No están para vigilar físicos. Estos son valores extremos pero
    // perfectamente humanos, y todos tienen que pasar.
    const reales = [
      ["weight", 42], ["weight", 180],
      ["waist", 55], ["waist", 160],
      ["neck", 28], ["neck", 55],
      ["bicepsContractedL", 24], ["bicepsContractedL", 55],
      ["calfL", 28], ["calfL", 55],
    ];
    for (const [field, value] of reales) {
      assert.equal(
        isPlausibleAnthropometry(field, value),
        true,
        `${field}=${value} debería aceptarse: es una persona real`
      );
    }
  });

  await t.test("las erratas típicas se rechazan", () => {
    const erratas = [
      ["abdomen", 44], // no es un adulto
      ["waist", 800], // cero de más
      ["weight", 7], // faltó un dígito
      ["weight", 3000],
      ["neck", 3],
    ];
    for (const [field, value] of erratas) {
      assert.equal(isPlausibleAnthropometry(field, value), false, `${field}=${value}`);
    }
  });

  await t.test("un campo sin cotas acepta: ante la duda no se descarta un dato bueno", () => {
    assert.equal(isPlausibleValue({}, 12345), true);
    assert.equal(isPlausibleValue(null, 12345), true);
  });

  await t.test("lo que no es número nunca es plausible", () => {
    for (const value of [null, undefined, "84", NaN, Infinity, {}]) {
      assert.equal(isPlausibleValue({ min: 0, max: 100 }, value), false);
    }
  });

  await t.test("un campo desconocido no revienta", () => {
    assert.equal(isPlausibleAnthropometry("noExiste", 50), true);
  });
});

// LO QUE DE VERDAD PASÓ, y lo que las cotas min/max NO cazan.
//
// La alerta decía "Ombligo ha bajado 44,0 cm (-35,8%)". Los valores eran 123
// y 79: los DOS son perímetros de personas reales. Lo imposible no era
// ninguno de los dos números, era el salto entre ellos en una semana.
test("cotas de variación", async (t) => {
  await t.test("el caso real: 123 -> 79 cm de ombligo en 7 días es imposible", () => {
    assert.equal(isPlausibleAnthropometry("abdomen", 123), true, "123 es una persona real");
    assert.equal(isPlausibleAnthropometry("abdomen", 79), true, "79 es una persona real");
    // Y sin embargo el salto no puede ser:
    assert.equal(isPlausibleAnthropometryChange("abdomen", 123, 79, 7), false);
  });

  await t.test("una bajada real de cintura sí pasa", () => {
    // 100 -> 97 cm en dos semanas: mucho, pero pasa de verdad. Tiene que
    // llegar a la alerta, que para eso existe.
    assert.equal(isPlausibleAnthropometryChange("waist", 100, 97, 14), true);
  });

  await t.test("el mismo salto es creíble si hay meses de por medio", () => {
    // 123 -> 79 en seis meses es una transformación, no una errata. La cota
    // es por SEMANA justamente para no confundirlas.
    assert.equal(isPlausibleAnthropometryChange("abdomen", 123, 79, 180), true);
  });

  await t.test("el peso admite más variación semanal que un perímetro", () => {
    // Agua y glucógeno mueven el peso rápido; una circunferencia no.
    assert.equal(isPlausibleAnthropometryChange("weight", 80, 72, 7), true);
    assert.equal(isPlausibleAnthropometryChange("waist", 80, 72, 7), false);
  });

  await t.test("sin nada con que comparar, se acepta", () => {
    // Primera medición, mismo día, o valores ausentes: ante la duda NO se
    // descarta. Un dato bueno tirado es peor que uno malo, que todavía tiene
    // que superar el umbral de la alerta para llegar a alguien.
    assert.equal(isPlausibleAnthropometryChange("abdomen", null, 79, 7), true);
    assert.equal(isPlausibleAnthropometryChange("abdomen", 123, 79, 0), true);
    assert.equal(isPlausibleAnthropometryChange("abdomen", 0, 79, 7), true);
  });

  await t.test("un campo sin grupo conocido no se filtra", () => {
    assert.equal(isPlausibleAnthropometryChange("noExiste", 100, 10, 7), true);
  });
});
