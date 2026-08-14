const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeLevel,
  sanitizeSets,
  sanitizeExercises,
  sanitizeBlocks,
} = require("./workout-template-controller");

// Fase A del rediseño de entrenamiento — estas funciones son la única barrera
// entre lo que manda el cliente (trainer app) y lo que se guarda en
// WorkoutTemplate. Deliberadamente NO aceptan expectedWeight/expectedTempo:
// esos campos no existen en el Set real (revertidos en el Paso 0 de esta
// sesión) — una regresión aquí que los deje pasar sería el mismo error write-
// only-metadata de la Fase 1, otra vez.
test("sanitizeLevel", async (t) => {
  await t.test("valores válidos pasan tal cual", () => {
    assert.equal(sanitizeLevel("principiante"), "principiante");
    assert.equal(sanitizeLevel("avanzado"), "avanzado");
  });

  await t.test("valor inválido o ausente -> intermedio", () => {
    assert.equal(sanitizeLevel("experto"), "intermedio");
    assert.equal(sanitizeLevel(undefined), "intermedio");
  });
});

test("sanitizeSets", async (t) => {
  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeSets(null), []);
    assert.deepEqual(sanitizeSets("no soy un array"), []);
  });

  await t.test("expectedReps/expectedRir no numéricos se descartan", () => {
    const result = sanitizeSets([{ expectedReps: [8, "x", 10], expectedRir: ["y", 2] }]);
    assert.deepEqual(result[0].expectedReps, [8, 10]);
    assert.deepEqual(result[0].expectedRir, [2]);
  });

  await t.test("restPause/expectedDistance no numéricos -> null, no NaN", () => {
    const result = sanitizeSets([{ restPause: "x", expectedDistance: undefined }]);
    assert.equal(result[0].restPause, null);
    assert.equal(result[0].expectedDistance, null);
  });

  await t.test("expectedTime se recorta a 20 caracteres", () => {
    const result = sanitizeSets([{ expectedTime: "a".repeat(30) }]);
    assert.equal(result[0].expectedTime.length, 20);
  });

  await t.test("nunca cuela expectedWeight/expectedTempo/rpe aunque el body los mande", () => {
    const result = sanitizeSets([
      { expectedReps: [8], expectedWeight: 100, expectedTempo: "3-1-1", rpe: 8 },
    ]);
    assert.equal(result[0].expectedWeight, undefined);
    assert.equal(result[0].expectedTempo, undefined);
    assert.equal(result[0].rpe, undefined);
  });
});

test("sanitizeExercises", async (t) => {
  await t.test("descarta ejercicios sin referencia a exercise", () => {
    const result = sanitizeExercises([{ order: 0 }, { exercise: "abc123", order: 1 }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].exercise, "abc123");
  });

  await t.test("order ausente cae al índice en el array", () => {
    const result = sanitizeExercises([{ exercise: "a" }, { exercise: "b" }]);
    assert.equal(result[0].order, 0);
    assert.equal(result[1].order, 1);
  });

  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeExercises(undefined), []);
  });
});

test("sanitizeBlocks", async (t) => {
  await t.test("type inválido cae a 'straight'", () => {
    const result = sanitizeBlocks([{ type: "no-existe" }]);
    assert.equal(result[0].type, "straight");
  });

  await t.test("type válido pasa tal cual", () => {
    const result = sanitizeBlocks([{ type: "superset" }]);
    assert.equal(result[0].type, "superset");
  });

  await t.test("rounds/restBetweenExercises/restBetweenRounds no numéricos -> null", () => {
    const result = sanitizeBlocks([{ rounds: "x", restBetweenExercises: null }]);
    assert.equal(result[0].rounds, null);
    assert.equal(result[0].restBetweenExercises, null);
  });

  await t.test("propaga exercises sanitizados dentro del bloque", () => {
    const result = sanitizeBlocks([
      { exercises: [{ exercise: "a" }, { order: 5 }] },
    ]);
    assert.equal(result[0].exercises.length, 1);
    assert.equal(result[0].exercises[0].exercise, "a");
  });

  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeBlocks(null), []);
  });
});
