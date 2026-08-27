const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PAIN_ZONES,
  PAIN_BANDS,
  PAIN_MIN,
  PAIN_MAX,
  PAIN_LIMITING_LEVEL,
  bandFor,
  sanitizePainEntry,
  sanitizeThreshold,
} = require("./pain-catalog");

// El dolor es lo único de la app que puede obligar a parar un entrenamiento.
// Si el saneado deja pasar un nivel fuera de rango o una zona inventada, el
// aviso al entrenador se dispara (o no) sobre un dato que no significa nada.

test("sanitizePainEntry", async (t) => {
  await t.test("conserva zona, nivel y nota", () => {
    assert.deepEqual(
      sanitizePainEntry({ zone: "Rodilla der.", level: 6, note: "  Al bajar en sentadilla " }),
      { zone: "Rodilla der.", level: 6, note: "Al bajar en sentadilla" }
    );
  });

  await t.test("el nivel 0 SÍ se guarda: 'hoy no me duele' es información", () => {
    // A diferencia de las agujetas, aquí el 0 es el dato que enseña que una
    // lesión se está cerrando.
    assert.deepEqual(sanitizePainEntry({ zone: "Rodilla der.", level: 0 }), {
      zone: "Rodilla der.",
      level: 0,
      note: "",
    });
  });

  await t.test("descarta zonas fuera del catálogo", () => {
    assert.equal(sanitizePainEntry({ zone: "Rodilla", level: 5 }), null);
    assert.equal(sanitizePainEntry({ zone: "", level: 5 }), null);
    assert.equal(sanitizePainEntry({ level: 5 }), null);
  });

  await t.test("descarta niveles fuera de 0-10 o no enteros", () => {
    for (const level of [-1, 11, 5.5, "mucho", null, undefined, NaN]) {
      assert.equal(
        sanitizePainEntry({ zone: "Cuello", level }),
        null,
        `nivel aceptado indebidamente: ${level}`
      );
    }
  });

  await t.test("acepta los dos extremos de la escala", () => {
    assert.equal(sanitizePainEntry({ zone: "Cuello", level: PAIN_MIN }).level, PAIN_MIN);
    assert.equal(sanitizePainEntry({ zone: "Cuello", level: PAIN_MAX }).level, PAIN_MAX);
  });

  await t.test("recorta la nota a 300 caracteres", () => {
    const entry = sanitizePainEntry({ zone: "Cuello", level: 3, note: "x".repeat(500) });
    assert.equal(entry.note.length, 300);
  });

  await t.test("entradas basura devuelven null, nunca revientan", () => {
    assert.equal(sanitizePainEntry(null), null);
    assert.equal(sanitizePainEntry(undefined), null);
    assert.equal(sanitizePainEntry("Cuello"), null);
  });
});

test("sanitizeThreshold", async (t) => {
  await t.test("conserva los dos umbrales", () => {
    assert.deepEqual(
      sanitizeThreshold({ zone: "Hombro izq.", workLevel: 3, painLevel: 6, note: "Sin press militar" }),
      { zone: "Hombro izq.", workLevel: 3, painLevel: 6, note: "Sin press militar" }
    );
  });

  await t.test("si vienen del revés se corrigen, no se rechazan", () => {
    // Un umbral de trabajo por encima del de dolor diría "sigue" y "para" a
    // la vez. Quien lo escribió quiso decir dos números, no romper nada.
    assert.deepEqual(sanitizeThreshold({ zone: "Cuello", workLevel: 8, painLevel: 2 }), {
      zone: "Cuello",
      workLevel: 2,
      painLevel: 8,
      note: "",
    });
  });

  await t.test("los dos iguales es válido: se para justo donde empieza a molestar", () => {
    const threshold = sanitizeThreshold({ zone: "Cuello", workLevel: 4, painLevel: 4 });
    assert.equal(threshold.workLevel, 4);
    assert.equal(threshold.painLevel, 4);
  });

  await t.test("descarta zona o niveles no válidos", () => {
    assert.equal(sanitizeThreshold({ zone: "Rodilla", workLevel: 3, painLevel: 6 }), null);
    assert.equal(sanitizeThreshold({ zone: "Cuello", workLevel: 3, painLevel: 11 }), null);
    assert.equal(sanitizeThreshold({ zone: "Cuello", workLevel: null, painLevel: 6 }), null);
    assert.equal(sanitizeThreshold(null), null);
  });
});

test("catálogo de dolor", async (t) => {
  await t.test("15 zonas, sin repetidas ni vacías", () => {
    assert.equal(PAIN_ZONES.length, 15);
    assert.equal(new Set(PAIN_ZONES).size, 15);
    for (const zone of PAIN_ZONES) assert.ok(zone.trim().length > 0);
  });

  await t.test("los tramos cubren el 0-10 entero, sin huecos ni solapes", () => {
    // Un hueco dejaría un nivel sin frase; un solape, dos frases para el
    // mismo número. Las dos cosas se ven solo cuando ya están en producción.
    for (let level = PAIN_MIN; level <= PAIN_MAX; level++) {
      const matches = PAIN_BANDS.filter((band) => level >= band.from && level <= band.to);
      assert.equal(matches.length, 1, `nivel ${level}: ${matches.length} tramos`);
    }
  });

  await t.test("bandFor devuelve el tramo correcto en los bordes", () => {
    assert.equal(bandFor(0).label, "Sin dolor");
    assert.equal(bandFor(4).from, 3);
    assert.equal(bandFor(5).from, 5);
    assert.equal(bandFor(10).to, 10);
  });

  await t.test("fuera de rango no hay tramo", () => {
    assert.equal(bandFor(-1), null);
    assert.equal(bandFor(11), null);
  });

  await t.test("el umbral limitante coincide con el inicio de su tramo", () => {
    // Si el aviso saltara en un número que cae a mitad de un tramo, el
    // entrenador vería "moderado" en dos filas y aviso solo en una.
    const band = bandFor(PAIN_LIMITING_LEVEL);
    assert.equal(band.from, PAIN_LIMITING_LEVEL);
  });
});

// Mismo riesgo que los otros dos catálogos: vive dos veces y se sincroniza a
// mano. Si el front ofrece una zona que el backend no conoce, el cliente la
// marca y el dato se rechaza.
test("el catálogo de dolor del front es idéntico al del backend", async (t) => {
  const MIRROR = path.join(
    __dirname,
    "../../../train-fit-front/packages/shared-core/src/app/core/constants/pain.ts"
  );

  await t.test("mismas zonas, mismos tramos y mismos límites", (ctx) => {
    if (!fs.existsSync(MIRROR)) return ctx.skip("no hay repo de front al lado");

    const source = fs.readFileSync(MIRROR, "utf8");

    const extractArray = (declaration) => {
      const start = source.indexOf(declaration);
      assert.ok(start >= 0, `no se encuentra ${declaration} en el espejo`);
      const open = source.indexOf("[", start);
      const close = source.indexOf("];", open);
      assert.ok(close > open, `${declaration} sin cierre`);
      // eslint-disable-next-line no-new-func
      return new Function(`return ${source.slice(open, close + 1)}`)();
    };

    const extractNumber = (declaration) => {
      const match = source.match(new RegExp(`${declaration}\\s*=\\s*(\\d+)`));
      assert.ok(match, `no se encuentra ${declaration} en el espejo`);
      return Number(match[1]);
    };

    assert.deepEqual(extractArray("export const PAIN_ZONES: string[] = ["), PAIN_ZONES);
    assert.deepEqual(extractArray("export const PAIN_BANDS: PainBand[] = ["), PAIN_BANDS);
    assert.equal(extractNumber("PAIN_MIN"), PAIN_MIN);
    assert.equal(extractNumber("PAIN_MAX"), PAIN_MAX);
    assert.equal(extractNumber("PAIN_LIMITING_LEVEL"), PAIN_LIMITING_LEVEL);
  });
});
