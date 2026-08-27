const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SCORE_MUSCLES,
  SCORE_JOINTS,
  SCORE_MIN,
  SCORE_MAX,
  MUSCLE_SCORE_ANCHORS,
  JOINT_SCORE_ANCHORS,
  toScoreOrNull,
  sanitizeMuscleScores,
  sanitizeJointScores,
} = require("./exercise-score-catalog");
const { SORENESS_MUSCLES } = require("../workouts/soreness-catalog");

// Estas puntuaciones son el método del entrenador. Si el saneado deja pasar
// un músculo inventado o una puntuación fuera de escala, el reparto de la
// sesión suma sobre datos que no significan nada — y el entrenador programa
// sobre eso.

test("toScoreOrNull", async (t) => {
  await t.test("acepta la escala entera, incluido el 0", () => {
    for (const score of [0, 1, 2, 3]) {
      assert.equal(toScoreOrNull(score), score);
    }
  });

  await t.test("un valor ausente NO se convierte en 0", () => {
    // Number(null) y Number("") son 0, y 0 es una puntuación válida aquí
    // ("no lo trabaja"). Sin descartar antes de convertir, una puntuación
    // que no llegó se guardaría como una decisión explícita del entrenador.
    assert.equal(toScoreOrNull(null), null);
    assert.equal(toScoreOrNull(undefined), null);
    assert.equal(toScoreOrNull(""), null);
  });

  await t.test("descarta fuera de escala y no enteros", () => {
    for (const score of [-1, 4, 1.5, "mucho", NaN]) {
      assert.equal(toScoreOrNull(score), null, `aceptado indebidamente: ${score}`);
    }
  });
});

test("sanitizeMuscleScores", async (t) => {
  await t.test("conserva los grupos válidos", () => {
    const clean = sanitizeMuscleScores([
      { name: "Pectoral", score: 3 },
      { name: "Tríceps", score: 2 },
    ]);
    assert.deepEqual(clean, [
      { name: "Pectoral", score: 3 },
      { name: "Tríceps", score: 2 },
    ]);
  });

  await t.test("descarta el 0: la ausencia ya significa 'no lo trabaja'", () => {
    // Guardar dieciséis ceros por ejercicio multiplicaría el tamaño de la
    // colección para no decir nada.
    assert.deepEqual(sanitizeMuscleScores([{ name: "Gemelo", score: 0 }]), []);
  });

  await t.test("devuelve en el orden del catálogo, no en el de llegada", () => {
    const clean = sanitizeMuscleScores([
      { name: "Gemelo", score: 1 },
      { name: "Pectoral", score: 3 },
    ]);
    assert.deepEqual(
      clean.map((entry) => entry.name),
      ["Pectoral", "Gemelo"]
    );
  });

  await t.test("descarta músculos que no están en el catálogo", () => {
    assert.deepEqual(sanitizeMuscleScores([{ name: "Deltoides poterior", score: 2 }]), []);
    assert.deepEqual(sanitizeMuscleScores([{ name: "Hombro", score: 2 }]), []);
  });

  await t.test("un músculo repetido se queda con su primera puntuación", () => {
    const clean = sanitizeMuscleScores([
      { name: "Pectoral", score: 3 },
      { name: "Pectoral", score: 1 },
    ]);
    assert.deepEqual(clean, [{ name: "Pectoral", score: 3 }]);
  });

  await t.test("entradas basura devuelven vacío, nunca revientan", () => {
    assert.deepEqual(sanitizeMuscleScores(null), []);
    assert.deepEqual(sanitizeMuscleScores("Pectoral"), []);
    assert.deepEqual(sanitizeMuscleScores([null, 3, {}]), []);
  });
});

test("sanitizeJointScores", async (t) => {
  await t.test("acepta articulaciones, no músculos", () => {
    assert.deepEqual(sanitizeJointScores([{ name: "Hombro", score: 2 }]), [
      { name: "Hombro", score: 2 },
    ]);
    // "Pectoral" es un músculo: en la lista de articulaciones no vale.
    assert.deepEqual(sanitizeJointScores([{ name: "Pectoral", score: 2 }]), []);
  });
});

test("catálogo de puntuaciones", async (t) => {
  await t.test("los músculos son EXACTAMENTE los del registro de agujetas", () => {
    // Dos listas distintas harían imposible cruzar "qué le estimulo" con
    // "qué le duele", que es justo lo que da valor a tener las dos.
    assert.deepEqual(SCORE_MUSCLES, SORENESS_MUSCLES);
  });

  await t.test("8 articulaciones, sin repetidas ni vacías", () => {
    assert.equal(SCORE_JOINTS.length, 8);
    assert.equal(new Set(SCORE_JOINTS).size, 8);
    for (const joint of SCORE_JOINTS) assert.ok(joint.trim().length > 0);
  });

  await t.test("una frase por cada nivel de la escala, en ambas escalas", () => {
    const levels = SCORE_MAX - SCORE_MIN + 1;
    assert.equal(MUSCLE_SCORE_ANCHORS.length, levels);
    assert.equal(JOINT_SCORE_ANCHORS.length, levels);
    for (const anchor of [...MUSCLE_SCORE_ANCHORS, ...JOINT_SCORE_ANCHORS]) {
      assert.ok(anchor.trim().length > 0);
    }
  });

  await t.test("la escala empieza en 0: 'no lo trabaja' es una respuesta", () => {
    assert.equal(SCORE_MIN, 0);
    assert.equal(MUSCLE_SCORE_ANCHORS[0], "No lo trabaja");
  });
});

// Mismo riesgo que los otros catálogos: vive dos veces y se sincroniza a
// mano. Si el front ofrece una articulación que el backend no conoce, el
// entrenador la puntúa y el dato se descarta en silencio.
test("el catálogo de puntuaciones del front es idéntico al del backend", async (t) => {
  const MIRROR = path.join(
    __dirname,
    "../../../train-fit-front/packages/shared-core/src/app/core/constants/exercise-score.ts"
  );

  await t.test("mismas articulaciones, mismas anclas y mismos límites", (ctx) => {
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

    assert.deepEqual(extractArray("export const SCORE_JOINTS: string[] = ["), SCORE_JOINTS);
    assert.deepEqual(
      extractArray("export const MUSCLE_SCORE_ANCHORS: string[] = ["),
      MUSCLE_SCORE_ANCHORS
    );
    assert.deepEqual(
      extractArray("export const JOINT_SCORE_ANCHORS: string[] = ["),
      JOINT_SCORE_ANCHORS
    );
    assert.equal(extractNumber("SCORE_MIN"), SCORE_MIN);
    assert.equal(extractNumber("SCORE_MAX"), SCORE_MAX);

    // Los músculos no se comparan como literal: el espejo los importa de
    // soreness.ts igual que aquí, y eso es lo que se comprueba.
    assert.match(
      source,
      /export const SCORE_MUSCLES: string\[\] = SORENESS_MUSCLES;/,
      "el front ya no reutiliza los músculos del registro de agujetas"
    );
  });
});
