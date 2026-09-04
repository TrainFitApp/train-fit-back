const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SECONDS_PER_SET,
  DEFAULT_REST_SECONDS,
  buildSessionLoad,
  estimateSessionSeconds,
  formatDuration,
} = require("./session-load-service");

// Esto es lo que el entrenador mira mientras monta una sesión para decidir
// si añade o quita series. Un reparto que ignora en silencio media sesión, o
// una duración que se queda a la mitad, le hacen programar mal.

function exercise(exerciseId, setCount, restSeconds) {
  return {
    exercise: { _id: exerciseId },
    sets: Array.from({ length: setCount }, () => ({ restSeconds })),
  };
}

const SCORES = new Map([
  [
    "press",
    {
      muscleScores: [
        { name: "Pectoral", score: 3 },
        { name: "Tríceps", score: 2 },
      ],
      jointScores: [{ name: "Hombro", score: 2 }],
      secondsPerSet: 45,
    },
  ],
  [
    "curl",
    {
      muscleScores: [{ name: "Bíceps", score: 3 }],
      jointScores: [{ name: "Codo", score: 1 }],
      secondsPerSet: null,
    },
  ],
]);

test("buildSessionLoad", async (t) => {
  await t.test("multiplica la puntuación por las SERIES, no la suma a secas", () => {
    // Cuatro series de press cargan el pectoral el doble que dos. Sumar solo
    // el 3 del ejercicio diría que da igual.
    const load = buildSessionLoad([exercise("press", 4, 90)], SCORES);
    const pectoral = load.muscles.find((m) => m.name === "Pectoral");
    assert.equal(pectoral.load, 12);
  });

  await t.test("acumula el mismo músculo entre ejercicios distintos", () => {
    const scores = new Map([
      ["a", { muscleScores: [{ name: "Pectoral", score: 3 }], jointScores: [] }],
      ["b", { muscleScores: [{ name: "Pectoral", score: 1 }], jointScores: [] }],
    ]);
    const load = buildSessionLoad([exercise("a", 3, 90), exercise("b", 2, 90)], scores);
    assert.equal(load.muscles[0].load, 11); // 3×3 + 1×2
  });

  await t.test("ordena de más a menos carga", () => {
    const load = buildSessionLoad([exercise("press", 4, 90)], SCORES);
    assert.deepEqual(
      load.muscles.map((m) => m.name),
      ["Pectoral", "Tríceps"]
    );
  });

  await t.test("cuenta los ejercicios sin puntuar en vez de ignorarlos en silencio", () => {
    // Un reparto que ignora media sesión es peor que ninguno: parece completo.
    const load = buildSessionLoad(
      [exercise("press", 3, 90), exercise("desconocido", 3, 90)],
      SCORES
    );
    assert.equal(load.totalExercises, 2);
    assert.equal(load.unscoredExercises, 1);
  });

  await t.test("un ejercicio sin series no aporta carga", () => {
    const load = buildSessionLoad([exercise("press", 0, 90)], SCORES);
    assert.deepEqual(load.muscles, []);
  });

  await t.test("articulaciones por separado de los músculos", () => {
    const load = buildSessionLoad([exercise("press", 3, 90), exercise("curl", 3, 60)], SCORES);
    const byJoint = Object.fromEntries(load.joints.map((j) => [j.name, j.load]));
    assert.equal(byJoint.Hombro, 6);
    assert.equal(byJoint.Codo, 3);
  });

  await t.test("sin ejercicios devuelve listas vacías, no revienta", () => {
    const load = buildSessionLoad([], SCORES);
    assert.deepEqual(load.muscles, []);
    assert.deepEqual(load.joints, []);
    assert.equal(load.totalExercises, 0);
    assert.deepEqual(buildSessionLoad(null, SCORES).muscles, []);
  });
});

test("estimateSessionSeconds", async (t) => {
  await t.test("suma ejecución + descanso de cada serie", () => {
    // 3 series × (45 s + 90 s) = 405, menos el último descanso.
    const seconds = estimateSessionSeconds([exercise("press", 3, 90)], SCORES);
    assert.equal(seconds, 3 * (45 + 90) - 90);
  });

  await t.test("el descanso de la última serie no cuenta: nadie descansa al terminar", () => {
    const one = estimateSessionSeconds([exercise("press", 1, 90)], SCORES);
    assert.equal(one, 45);
  });

  await t.test("usa el tiempo por serie del ejercicio cuando lo hay", () => {
    // press tiene 45 s; curl no tiene, así que cae al valor por defecto.
    const press = estimateSessionSeconds([exercise("press", 2, 0)], SCORES);
    const curl = estimateSessionSeconds([exercise("curl", 2, 0)], SCORES);
    assert.equal(press, 90);
    assert.equal(curl, DEFAULT_SECONDS_PER_SET * 2);
  });

  await t.test("una serie sin descanso escrito usa el descanso por defecto", () => {
    const seconds = estimateSessionSeconds(
      [{ exercise: { _id: "press" }, sets: [{}, {}] }],
      SCORES
    );
    assert.equal(seconds, 45 * 2 + DEFAULT_REST_SECONDS);
  });

  await t.test("un ejercicio sin puntuar sigue contando tiempo", () => {
    // No saber cuánto estimula un ejercicio no significa que no ocupe rato.
    const seconds = estimateSessionSeconds([exercise("desconocido", 2, 60)], SCORES);
    assert.equal(seconds, DEFAULT_SECONDS_PER_SET * 2 + 60);
  });

  await t.test("una sesión vacía dura 0, no un número negativo", () => {
    assert.equal(estimateSessionSeconds([], SCORES), 0);
    assert.equal(estimateSessionSeconds([exercise("press", 0, 90)], SCORES), 0);
    assert.equal(estimateSessionSeconds(null, SCORES), 0);
  });
});

test("formatDuration", async (t) => {
  await t.test("por debajo de una hora, en minutos", () => {
    assert.equal(formatDuration(45 * 60), "45 min");
  });

  await t.test("por encima, en horas y minutos", () => {
    assert.equal(formatDuration(75 * 60), "1 h 15 min");
  });

  await t.test("una hora justa no dice '1 h 0 min'", () => {
    assert.equal(formatDuration(60 * 60), "1 h");
  });

  await t.test("cero no revienta", () => {
    assert.equal(formatDuration(0), "0 min");
    assert.equal(formatDuration(null), "0 min");
  });
});

// Los tests de arriba construyen los ejercicios a mano, con `exercise` YA
// poblado — que es justo lo que ocultó un fallo real durante meses:
// exercise-score-controller.js#getSessionLoad consultaba el workout con
// .lean(), y mongoose-autopopulate NO actúa sobre consultas lean, así que
// estas funciones recibían referencias peladas. El endpoint devolvía
// SIEMPRE un reparto vacío y una duración de 0, y el panel del planificador
// le pedía al entrenador que puntuara ejercicios que ya tenía puntuados.
// Este test fija esa frontera: si alguien vuelve a quitar el populate
// explícito del controller, aquí se ve QUÉ pasa.
test("sesión con ejercicios sin poblar (regresión del .lean())", async (t) => {
  await t.test("buildSessionLoad no reparte nada y no cuenta ni un ejercicio", () => {
    const load = buildSessionLoad(["ref-1", "ref-2"], SCORES);

    assert.deepEqual(load.muscles, []);
    assert.deepEqual(load.joints, []);
    assert.equal(load.totalExercises, 0);
    // El 0 es lo más dañino: la plantilla lo trata como falsy y ni siquiera
    // avisa de "X de Y sin puntuar" — el panel afirma en positivo que no hay
    // nada que repartir.
    assert.equal(load.unscoredExercises, 0);
  });

  await t.test("estimateSessionSeconds devuelve 0, no una estimación parcial", () => {
    assert.equal(estimateSessionSeconds(["ref-1", "ref-2"], SCORES), 0);
  });

  await t.test("con los mismos ejercicios poblados sí hay reparto y duración", () => {
    const poblados = [exercise("press", 3, 90), exercise("curl", 2, 60)];

    const load = buildSessionLoad(poblados, SCORES);
    assert.equal(load.totalExercises, 2);
    assert.ok(load.muscles.length > 0);
    assert.ok(estimateSessionSeconds(poblados, SCORES) > 0);
  });
});
