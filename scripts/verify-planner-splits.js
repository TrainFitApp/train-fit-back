const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-planner-splits]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Planificador visual (Fase C) — script aislado y autolimpiante contra la BD
// real de desarrollo: confirma de extremo a extremo los 4 endpoints nuevos
// del tablero Kanban (añadir semana en blanco, reordenar columnas, copiar
// una card a otra semana, reordenar cards dentro de una columna). Mismo
// patrón que scripts/verify-workout-template-apply.js.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const exerciseSchema = require("../components/exercises/exercise-schema");
  const tableSchema = require("../components/tables/table-schema");
  const splitSchema = require("../components/splits/split-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const setSchema = require("../components/sets/set-schema");
  const splitDao = require("../components/splits/split-dao");
  const workoutDao = require("../components/workouts/workout-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    client: null,
    exercise: null,
    table: null,
    split1: null,
    split2: null,
    workout1Id: null,
    blankSplitId: null,
    copiedWorkoutId: null,
    extraWorkoutId: null,
    blankCardWorkoutId: null,
  };

  try {
    created.trainer = await userSchema.create({ email: `verify-planner-trainer-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-planner-client-${runId}@test.local` });
    created.exercise = await exerciseSchema.create({ name: "Verify Squat" });
    ok("usuarios/ejercicio de prueba creados");

    const set = await setSchema.create({ expectedReps: [8, 8], expectedRir: [2] });
    const customExercise = await customExerciseSchema.create({
      exercise: created.exercise._id,
      sets: [set._id],
    });
    const workout1 = await workoutSchema.create({
      name: "Torso",
      exercises: [customExercise._id],
    });
    created.workout1Id = workout1._id;

    created.split1 = await splitSchema.create({ name: "Semana 1", workouts: [workout1._id] });
    created.split2 = await splitSchema.create({ name: "Semana 2", workouts: [] });
    created.table = await tableSchema.create({
      name: "Tabla planificador de verificación",
      userId: created.client._id,
      splits: [created.split1._id, created.split2._id],
    });
    ok("table/splits/workout de prueba creados", created.table._id);

    // --- createBlankSplitAndAddToTable ---
    let splits = await splitDao.createBlankSplitAndAddToTable(created.table._id.toString(), "Semana 3");
    assert.equal(splits.length, 3, "debe haber 3 splits tras añadir la semana en blanco");
    const blankSplit = splits[2];
    created.blankSplitId = blankSplit._id;
    assert.equal(blankSplit.name, "Semana 3");
    assert.deepEqual(blankSplit.workouts, [], "la semana en blanco no debe traer ningún workout");
    ok("createBlankSplitAndAddToTable: semana en blanco creada sin workouts");

    // --- reorderSplits ---
    const reversedOrder = [blankSplit._id, created.split2._id, created.split1._id];
    splits = await splitDao.reorderSplits(created.table._id.toString(), reversedOrder.map(String));
    assert.deepEqual(
      splits.map((s) => s._id.toString()),
      reversedOrder.map(String),
      "el nuevo orden debe persistirse exactamente como se pidió"
    );
    ok("reorderSplits: nuevo orden persistido correctamente");

    await assert.rejects(
      () => splitDao.reorderSplits(created.table._id.toString(), [created.split1._id.toString()]),
      /permutación/,
      "una lista que no es permutación exacta debe rechazarse"
    );
    ok("reorderSplits: rechaza una lista que no es permutación válida");

    // --- copyWorkoutToSplit ---
    splits = await workoutDao.copyWorkoutToSplit(created.workout1Id.toString(), created.split2._id.toString());
    const targetSplitAfterCopy = splits.find((s) => s._id.toString() === created.split2._id.toString());
    assert.equal(targetSplitAfterCopy.workouts.length, 1, "split2 debe tener 1 workout copiado");
    const copiedWorkout = targetSplitAfterCopy.workouts[0];
    created.copiedWorkoutId = copiedWorkout._id;
    assert.notEqual(copiedWorkout._id.toString(), created.workout1Id.toString(), "la copia debe ser un documento nuevo, no el mismo");
    assert.equal(copiedWorkout.name, "Torso");
    assert.equal(copiedWorkout.exercises.length, 1, "el ejercicio debe copiarse también");
    assert.notEqual(
      copiedWorkout.exercises[0]._id.toString(),
      customExercise._id.toString(),
      "el CustomExercise copiado debe ser un documento independiente"
    );
    assert.deepEqual(copiedWorkout.exercises[0].sets[0].expectedReps, [8, 8], "los sets copiados deben preservar la prescripción");
    ok("copyWorkoutToSplit: card copiada a otra semana con exercises/sets independientes");

    // "Duplicar en el sitio" = mismo endpoint, split origen como destino.
    splits = await workoutDao.copyWorkoutToSplit(created.workout1Id.toString(), created.split1._id.toString());
    const split1AfterDuplicate = splits.find((s) => s._id.toString() === created.split1._id.toString());
    assert.equal(split1AfterDuplicate.workouts.length, 2, "duplicar en el sitio añade una segunda card a la misma semana");
    created.extraWorkoutId = split1AfterDuplicate.workouts.find(
      (w) => w._id.toString() !== created.workout1Id.toString()
    )._id;
    ok("copyWorkoutToSplit: duplicar en el sitio (mismo split como destino) funciona");

    // --- reorderWorkoutsInSplit ---
    const workoutOrderInSplit1 = split1AfterDuplicate.workouts.map((w) => w._id.toString()).reverse();
    splits = await workoutDao.reorderWorkoutsInSplit(created.split1._id.toString(), workoutOrderInSplit1);
    const split1AfterReorder = splits.find((s) => s._id.toString() === created.split1._id.toString());
    assert.deepEqual(
      split1AfterReorder.workouts.map((w) => w._id.toString()),
      workoutOrderInSplit1,
      "el orden de cards dentro de la columna debe persistirse exactamente"
    );
    ok("reorderWorkoutsInSplit: orden de cards dentro de una sola columna persistido");

    await assert.rejects(
      () => workoutDao.reorderWorkoutsInSplit(created.split1._id.toString(), [created.workout1Id.toString()]),
      /permutación/,
      "una lista que no es permutación exacta debe rechazarse"
    );
    ok("reorderWorkoutsInSplit: rechaza una lista que no es permutación válida");

    // --- addWorkoutsSplit (usado por "+ Añadir entrenamiento" de una card
    // en blanco) — bug real encontrado y arreglado en esta misma fase:
    // findByIdAndUpdate sin { new: true } devolvía el split ANTERIOR a la
    // actualización, sin el workout recién añadido.
    const blankWorkout = await workoutSchema.create({ name: "Pierna", exercises: [] });
    created.blankCardWorkoutId = blankWorkout._id;
    const splitAfterAddCard = await splitDao.addWorkoutsSplit(
      created.split2._id.toString(),
      blankWorkout._id.toString()
    );
    assert.equal(
      splitAfterAddCard.workouts.some((w) => (w._id || w).toString() === blankWorkout._id.toString()),
      true,
      "addWorkoutsSplit debe devolver el split YA con el workout recién añadido (no el estado anterior)"
    );
    ok("addWorkoutsSplit: devuelve el split actualizado con { new: true }");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    const workoutIdsToDelete = [
      created.workout1Id,
      created.copiedWorkoutId,
      created.extraWorkoutId,
      created.blankCardWorkoutId,
    ].filter(Boolean);
    for (const workoutId of workoutIdsToDelete) {
      // deleteOne (no deleteMany) para disparar el hook en cascada que borra
      // los CustomExercise/Set asociados.
      await workoutSchema.deleteOne({ _id: workoutId });
    }
    if (created.split1) await splitSchema.deleteOne({ _id: created.split1._id });
    if (created.split2) await splitSchema.deleteOne({ _id: created.split2._id });
    if (created.blankSplitId) await splitSchema.deleteOne({ _id: created.blankSplitId });
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.exercise) await exerciseSchema.deleteOne({ _id: created.exercise._id });
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
    if (created.client) await userSchema.deleteOne({ _id: created.client._id });
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
