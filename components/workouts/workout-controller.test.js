const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeWorkoutBlocks } = require("./workout-controller");

// Rediseño de entrenamiento Fase B — sanitizeWorkoutBlocks es la única
// barrera entre lo que manda el trainer (editor real) y lo que reemplaza
// Workout.blocks[]. A diferencia de workoutTemplates/workout-template-
// controller.js#sanitizeBlocks, aquí no hay exercises[] anidados: las
// exercises ya son CustomExercise reales, vinculadas por blockId aparte.
test("sanitizeWorkoutBlocks", async (t) => {
  await t.test("no-array -> []", () => {
    assert.deepEqual(sanitizeWorkoutBlocks(null), []);
    assert.deepEqual(sanitizeWorkoutBlocks("no soy un array"), []);
  });

  await t.test("type inválido cae a 'straight'", () => {
    assert.equal(sanitizeWorkoutBlocks([{ type: "no-existe" }])[0].type, "straight");
  });

  await t.test("type válido pasa tal cual", () => {
    assert.equal(sanitizeWorkoutBlocks([{ type: "circuit" }])[0].type, "circuit");
  });

  await t.test("order ausente cae al índice en el array", () => {
    const result = sanitizeWorkoutBlocks([{ name: "a" }, { name: "b" }]);
    assert.equal(result[0].order, 0);
    assert.equal(result[1].order, 1);
  });

  await t.test("rounds/restBetweenExercises/restBetweenRounds ausentes o inválidos -> null, nunca 0", () => {
    const result = sanitizeWorkoutBlocks([{ rounds: null, restBetweenExercises: "x", restBetweenRounds: undefined }]);
    assert.equal(result[0].rounds, null);
    assert.equal(result[0].restBetweenExercises, null);
    assert.equal(result[0].restBetweenRounds, null);
  });

  await t.test("conserva el _id existente para poder editar un bloque en vez de recrearlo", () => {
    const result = sanitizeWorkoutBlocks([{ _id: "existing-id", name: "x" }]);
    assert.equal(result[0]._id, "existing-id");
  });

  await t.test("name/instructions se recortan y nunca quedan undefined", () => {
    const result = sanitizeWorkoutBlocks([{}]);
    assert.equal(result[0].name, "");
    assert.equal(result[0].instructions, "");
  });
});
