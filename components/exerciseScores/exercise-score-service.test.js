const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../workouts/workout-schema");
const Table = require("../tables/table-schema");
const Exercise = require("../exercises/exercise-schema");
const ExerciseScore = require("./exercise-score-schema");
const exerciseScoreService = require("./exercise-score-service");

// Carga de una sesión y de un microciclo: las puntuaciones del entrenador y,
// si un ejercicio no tiene, su sugerencia por defecto (exercise-score-defaults.js).
// Contra un Mongo efímero.
const db = useTestDb();

const loadOf = (list, name) => list.find((item) => item.name === name)?.load ?? 0;
const allowed = async () => true;

async function seed() {
  await db.reset();
  const trainerId = db.oid();
  // "Sentadilla…" casa con la sugerencia de sentadilla (Rodilla 2).
  const squat = await Exercise.create({ name: "Sentadilla trasera" });
  const bench = await Exercise.create({ name: "Press banca" });
  const odd = await Exercise.create({ name: "Ejercicio sin patrón" });
  await ExerciseScore.create({
    trainerId,
    exerciseId: bench._id,
    muscleScores: [{ name: "Pectoral", score: 3 }],
    jointScores: [{ name: "Hombro", score: 2 }],
  });
  const sets = (count) => Array.from({ length: count }, () => ({ expectedReps: [8] }));
  const legs = await Workout.create({ name: "Pierna", exercises: [{ exercise: squat._id, sets: sets(3) }] });
  const chest = await Workout.create({
    name: "Torso",
    exercises: [
      { exercise: bench._id, sets: sets(2) },
      { exercise: odd._id, sets: sets(4) },
    ],
  });
  const other = await Workout.create({ name: "Otra semana", exercises: [{ exercise: bench._id, sets: sets(5) }] });
  const table = await Table.create({
    name: "Rutina",
    userId: db.oid(),
    splits: [
      { name: "M1", workouts: [legs._id, chest._id] },
      { name: "M2", workouts: [other._id] },
    ],
  });
  return { trainerId, table, legs };
}

test("sessionLoad cuenta con la sugerencia por defecto si el ejercicio no está puntuado", async () => {
  const { trainerId, legs } = await seed();

  const load = await exerciseScoreService.sessionLoad(trainerId, legs._id, allowed);
  assert.equal(loadOf(load.joints, "Rodilla"), 6, "sugerencia de sentadilla: Rodilla 2 × 3 series");
  assert.equal(load.suggestedExercises, 1);
  assert.equal(load.unscoredExercises, 0);
  assert.ok(load.estimatedSeconds > 0);
});

test("splitLoad suma las sesiones del microciclo y dice cuántas van con sugerencia o sin puntuar", async () => {
  const { trainerId, table } = await seed();

  const load = await exerciseScoreService.splitLoad(trainerId, table.splits[0]._id, allowed);
  assert.equal(loadOf(load.joints, "Rodilla"), 6);
  assert.equal(loadOf(load.joints, "Hombro"), 4, "puntuación guardada: Hombro 2 × 2 series");
  assert.equal(loadOf(load.muscles, "Pectoral"), 6);
  assert.equal(load.totalExercises, 3);
  assert.equal(load.suggestedExercises, 1);
  assert.equal(load.unscoredExercises, 1, "sin puntuar y sin patrón conocido");
  assert.equal(load.estimatedSeconds, undefined, "la duración es solo de una sesión");
});

test("splitLoad comprueba el acceso y que el microciclo exista", async () => {
  const { trainerId, table } = await seed();
  await assert.rejects(exerciseScoreService.splitLoad(trainerId, table.splits[0]._id, async () => false), {
    status: 403,
  });
  await assert.rejects(exerciseScoreService.splitLoad(trainerId, db.oid(), allowed), { status: 404 });
});
