const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-large-table-read-performance]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-015 (MASTER_BACKLOG.md) — "sin ningún test que cubra esta ruta": este
// script reproduce el escenario EXACTO citado por el audit (12 semanas × 5
// días × 6 ejercicios × 4 series ≈ 2233 documentos, vía la cadena de
// autopopulate Table→Split→Workout→CustomExercise→Set/Exercise, sin
// .select()/.lean()/límite en ningún nivel — tableDao.getTableById() usa
// literalmente `Table.findById(id).exec()`) y mide cuánto tarda leerla tal
// cual hoy. NO optimiza nada (la complejidad real de tocar la cadena de
// autopopulate con seguridad, sin romper los ~14 puntos de escritura que
// dependen de recibir el documento completo, es mayor que "añadir
// .lean()" — ver DECISIONS.md, 2026-08-12) — sirve como línea base y red de
// seguridad de regresión para cuando se aborde la optimización real.
const SPLITS = 12;
const WORKOUTS_PER_SPLIT = 5;
const EXERCISES_PER_WORKOUT = 6;
const SETS_PER_EXERCISE = 4;

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const exerciseSchema = require("../components/exercises/exercise-schema");
  const setSchema = require("../components/sets/set-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const splitSchema = require("../components/splits/split-schema");
  const tableSchema = require("../components/tables/table-schema");
  const tableService = require("../components/tables/table-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    user: null,
    exercises: [],
    sets: [],
    customExercises: [],
    workouts: [],
    splits: [],
    table: null,
  };

  try {
    created.user = await userSchema.create({
      email: `verify-large-table-${runId}@test.local`,
    });

    // Catálogo pequeño de ejercicios reales reutilizados en toda la tabla
    // (mismo patrón que un entrenador real: repite ejercicios entre días).
    created.exercises = await exerciseSchema.insertMany(
      Array.from({ length: EXERCISES_PER_WORKOUT }, (_, i) => ({
        name: `Ejercicio de prueba ${i} ${runId}`,
      })),
    );
    ok(`${created.exercises.length} ejercicios de catálogo creados`);

    let totalSets = 0;
    let totalCustomExercises = 0;
    const splitIds = [];

    for (let s = 0; s < SPLITS; s++) {
      const workoutIds = [];
      for (let w = 0; w < WORKOUTS_PER_SPLIT; w++) {
        const customExerciseIds = [];
        for (let e = 0; e < EXERCISES_PER_WORKOUT; e++) {
          const sets = await setSchema.insertMany(
            Array.from({ length: SETS_PER_EXERCISE }, (_, i) => ({
              reps: 10,
              weight: 40,
              order: i,
            })),
          );
          created.sets.push(...sets);
          totalSets += sets.length;

          const customExercise = await customExerciseSchema.create({
            exercise: created.exercises[e]._id,
            sets: sets.map((st) => st._id),
            order: e,
          });
          created.customExercises.push(customExercise);
          customExerciseIds.push(customExercise._id);
          totalCustomExercises++;
        }

        const workout = await workoutSchema.create({
          name: `Día ${w + 1}`,
          exercises: customExerciseIds,
          order: w,
        });
        created.workouts.push(workout);
        workoutIds.push(workout._id);
      }

      const split = await splitSchema.create({
        name: `Semana ${s + 1}`,
        workouts: workoutIds,
      });
      created.splits.push(split);
      splitIds.push(split._id);
    }

    created.table = await tableSchema.create({
      name: `Tabla grande de prueba ${runId}`,
      userId: created.user._id,
      splits: splitIds,
    });

    const totalDocs =
      1 + // table
      created.splits.length +
      created.workouts.length +
      totalCustomExercises +
      totalSets +
      created.exercises.length;
    ok(
      `árbol creado: ${created.splits.length} splits, ${created.workouts.length} workouts, ` +
        `${totalCustomExercises} customExercises, ${totalSets} sets (~${totalDocs} documentos totales)`,
    );

    const startedAt = Date.now();
    const table = await tableService.getTableById(created.table._id.toString());
    const elapsedMs = Date.now() - startedAt;

    assert.ok(table, "la tabla debe poder leerse sin error a esta escala");
    assert.equal(table.splits.length, SPLITS, "todos los splits deben venir autopoblados");
    assert.equal(
      table.splits[0].workouts.length,
      WORKOUTS_PER_SPLIT,
      "los workouts de cada split deben venir autopoblados",
    );
    assert.equal(
      table.splits[0].workouts[0].exercises.length,
      EXERCISES_PER_WORKOUT,
      "los ejercicios de cada workout deben venir autopoblados",
    );
    assert.equal(
      table.splits[0].workouts[0].exercises[0].sets.length,
      SETS_PER_EXERCISE,
      "las series de cada ejercicio deben venir autopobladas",
    );
    assert.ok(
      table.splits[0].workouts[0].exercises[0].exercise?.name,
      "el catálogo de ejercicio también debe venir autopoblado (1 nivel más)",
    );

    ok(`getTableById() a esta escala (~${totalDocs} documentos) tardó ${elapsedMs} ms — línea base para comparar tras cualquier optimización futura`);
    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.splits.length) await splitSchema.deleteMany({ _id: { $in: created.splits.map((s) => s._id) } });
    if (created.workouts.length) await workoutSchema.deleteMany({ _id: { $in: created.workouts.map((w) => w._id) } });
    if (created.customExercises.length) {
      await customExerciseSchema.deleteMany({ _id: { $in: created.customExercises.map((c) => c._id) } });
    }
    if (created.sets.length) await setSchema.deleteMany({ _id: { $in: created.sets.map((s) => s._id) } });
    if (created.exercises.length) await exerciseSchema.deleteMany({ _id: { $in: created.exercises.map((e) => e._id) } });
    if (created.user) await userSchema.deleteOne({ _id: created.user._id });
    ok("datos de prueba borrados");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
