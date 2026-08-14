const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-exercise-delete-usage-check]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-016 (MASTER_BACKLOG.md) — script aislado y autolimpiante: confirma
// que borrar un Exercise referenciado por un WorkoutTemplate se bloquea
// (409, sin mecanismo de limpieza para esa referencia), y que borrar un
// Exercise SOLO referenciado por un CustomExercise (rutina real de cliente)
// sigue funcionando tal cual — ese caso ya lo cascada el hook
// pre('deleteOne') de exercise-schema.js (borra el CustomExercise y lo
// desengancha del Workout), comportamiento preexistente que no debe
// romperse.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const exerciseSchema = require("../components/exercises/exercise-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const workoutTemplateSchema = require("../components/workoutTemplates/workout-template-schema");
  const exerciseModel = require("../components/exercises/exercise-model");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    exerciseInTemplate: null,
    exerciseInCustomOnly: null,
    template: null,
    customExercise: null,
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-exercise-delete-${runId}@test.local`,
    });
    ok("trainer de prueba creado", created.trainer._id);

    created.exerciseInTemplate = await exerciseSchema.create({
      name: `Ejercicio en plantilla ${runId}`,
    });
    created.exerciseInCustomOnly = await exerciseSchema.create({
      name: `Ejercicio solo en rutina real ${runId}`,
    });
    ok("ejercicios de prueba creados");

    created.template = await workoutTemplateSchema.create({
      trainerId: created.trainer._id,
      name: `Plantilla de prueba ${runId}`,
      blocks: [
        {
          type: "straight",
          order: 0,
          exercises: [
            { exercise: created.exerciseInTemplate._id, order: 0, sets: [] },
          ],
        },
      ],
    });
    ok("plantilla de prueba creada, referencia al primer ejercicio");

    created.customExercise = await customExerciseSchema.create({
      exercise: created.exerciseInCustomOnly._id,
      sets: [],
      order: 0,
    });
    ok("CustomExercise de prueba creado, referencia al segundo ejercicio");

    // Caso 1: ejercicio usado en una plantilla — debe bloquearse.
    const usageBlocked = await exerciseModel.getExerciseUsage(
      created.exerciseInTemplate._id.toString(),
    );
    assert.equal(
      usageBlocked.workoutTemplateCount,
      1,
      "getExerciseUsage debe detectar 1 uso en WorkoutTemplate",
    );
    ok("getExerciseUsage detecta correctamente el uso en plantilla (este era el caso sin bloquear antes del fix)");

    // Caso 2: ejercicio usado solo en un CustomExercise real — NO debe
    // bloquearse (el hook pre('deleteOne') ya cascada esa referencia).
    const usageAllowed = await exerciseModel.getExerciseUsage(
      created.exerciseInCustomOnly._id.toString(),
    );
    assert.equal(
      usageAllowed.workoutTemplateCount,
      0,
      "getExerciseUsage no debe contar el uso en CustomExercise como bloqueante",
    );
    ok("getExerciseUsage NO bloquea el caso ya cubierto por la cascada existente (CustomExercise)");

    // Confirmar que el borrado real del caso 2 sigue funcionando (cascada
    // preexistente intacta): borra el Exercise, el hook debe borrar también
    // el CustomExercise vinculado.
    await exerciseModel.deleteExercise(created.exerciseInCustomOnly._id.toString());
    const customExerciseAfterDelete = await customExerciseSchema.findById(
      created.customExercise._id,
    );
    assert.equal(
      customExerciseAfterDelete,
      null,
      "el CustomExercise vinculado debe haberse borrado en cascada junto con el Exercise",
    );
    ok("cascada preexistente (Exercise -> CustomExercise) sigue funcionando tras el fix");
    created.customExercise = null;
    created.exerciseInCustomOnly = null; // ya borrado

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.template) await workoutTemplateSchema.deleteOne({ _id: created.template._id });
    if (created.customExercise) await customExerciseSchema.deleteOne({ _id: created.customExercise._id });
    if (created.exerciseInTemplate) await exerciseSchema.deleteOne({ _id: created.exerciseInTemplate._id });
    if (created.exerciseInCustomOnly) await exerciseSchema.deleteOne({ _id: created.exerciseInCustomOnly._id });
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
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
