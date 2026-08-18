const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-workout-template-apply]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Rediseño de entrenamiento (Fase A + Fase B) — script aislado y
// autolimpiante contra la BD real de desarrollo: confirma que
// WorkoutTemplate.applyToSplit materializa un Workout real con
// exercises/sets/blocks correctamente vinculados (no metadata write-only, la
// lección directa del error de la Fase 1 revertida), y que
// updateWorkoutBlocks/setCustomExerciseBlock (Fase B) funcionan de extremo a
// extremo sobre ese mismo Workout. Mismo patrón que scripts/migrate-*.js
// (conexión vía _mongo-uri.js), pero de un solo uso: crea todo lo que
// necesita y lo borra al final, pase o falle la verificación.
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
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const workoutTemplateDao = require("../components/workoutTemplates/workout-template-dao");
  const workoutDao = require("../components/workouts/workout-dao");
  const customExerciseDao = require("../components/customExercises/custom-exercise-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    client: null,
    exercise: null,
    table: null,
    split: null,
    relation: null,
    template: null,
    workoutId: null,
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-wt-trainer-${runId}@test.local`,
    });
    created.client = await userSchema.create({
      email: `verify-wt-client-${runId}@test.local`,
    });
    ok("usuarios de prueba creados", created.trainer._id, created.client._id);

    created.exercise = await exerciseSchema.create({ name: "Verify Press" });

    created.relation = await trainerClientSchema.create({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      clientEmail: created.client.email,
      scope: "training",
      status: "active",
      respondedAt: new Date(),
    });
    ok("relación trainer-cliente activa creada");

    created.split = await splitSchema.create({ name: "Semana 1", workouts: [] });
    created.table = await tableSchema.create({
      name: "Tabla de verificación",
      userId: created.client._id,
      splits: [created.split._id],
    });
    ok("table/split de prueba creados", created.table._id, created.split._id);

    created.template = await workoutTemplateDao.create(created.trainer._id, {
      name: "Plantilla de verificación",
      blocks: [
        {
          name: "Bloque A",
          type: "straight",
          order: 0,
          exercises: [
            {
              exercise: created.exercise._id,
              order: 0,
              notes: "nota de prueba",
              sets: [
                { expectedReps: [8, 8], expectedRir: [2] },
                { expectedReps: [6], expectedRir: [1] },
              ],
            },
          ],
        },
        {
          name: "Bloque B (vacío)",
          type: "finisher",
          order: 1,
          exercises: [],
        },
      ],
    });
    ok("WorkoutTemplate creada", created.template._id);

    log("aplicando plantilla al split...");
    // applyToSplit necesita el Workout-plantilla real (autopoblado), no el
    // objeto de respuesta ya "aplanado a anidado" que devuelve create() —
    // mismo dato que usa el controller real vía findOwnedByTrainer.
    const templateForApply = await workoutTemplateDao.findOwnedByTrainer(
      created.trainer._id,
      created.template._id
    );
    const resultSplits = await workoutTemplateDao.applyToSplit(
      templateForApply,
      created.split._id.toString(),
      created.client._id.toString()
    );

    const updatedSplit = resultSplits.find(
      (s) => s._id.toString() === created.split._id.toString()
    );
    assert.ok(updatedSplit, "el split aplicado debe estar en el resultado");
    assert.equal(updatedSplit.workouts.length, 1, "debe haberse creado exactamente 1 workout");

    const newWorkout = updatedSplit.workouts[0];
    created.workoutId = newWorkout._id;
    assert.equal(newWorkout.name, "Plantilla de verificación", "el Workout hereda el nombre de la plantilla");
    assert.equal(newWorkout.exercises.length, 1, "debe tener 1 CustomExercise materializado");

    const materializedExercise = newWorkout.exercises[0];
    assert.equal(
      materializedExercise.exercise._id.toString(),
      created.exercise._id.toString(),
      "el CustomExercise debe referenciar el Exercise real"
    );
    assert.equal(materializedExercise.notes, "nota de prueba");
    assert.equal(materializedExercise.sets.length, 2, "deben materializarse los 2 sets de la plantilla");
    assert.deepEqual(materializedExercise.sets[0].expectedReps, [8, 8]);
    assert.deepEqual(materializedExercise.sets[1].expectedReps, [6]);

    // Confirma que los Set/CustomExercise son documentos reales e
    // independientes en sus colecciones (no solo IDs sueltos en memoria) —
    // exactamente lo que la Fase 1 revertida NO garantizaba.
    const persistedSetsCount = await setSchema.countDocuments({
      _id: { $in: materializedExercise.sets.map((s) => s._id) },
    });
    assert.equal(persistedSetsCount, 2, "los Set deben existir de verdad en la colección sets");

    ok("Workout materializado correctamente: exercises/sets reales y vinculados");

    // --- Fase B: Workout.blocks[] reales + blockId vinculado ---
    assert.equal(newWorkout.blocks.length, 2, "deben materializarse los 2 bloques de la plantilla (incluido el vacío)");
    const [blockA, blockB] = newWorkout.blocks;
    assert.equal(blockA.name, "Bloque A");
    assert.equal(blockB.name, "Bloque B (vacío)");
    assert.equal(
      materializedExercise.blockId.toString(),
      blockA._id.toString(),
      "el CustomExercise materializado debe apuntar al bloque real correspondiente"
    );
    ok("Workout.blocks[] materializados y blockId vinculado correctamente");

    // --- Fase B: updateWorkoutBlocks — borrar el bloque A debe limpiar el
    // blockId huérfano del CustomExercise que apuntaba a él ---
    const workoutAfterBlockRemoval = await workoutDao.updateWorkoutBlocks(created.workoutId, [
      { _id: blockB._id, name: blockB.name, type: blockB.type, order: 0 },
    ]);
    assert.equal(workoutAfterBlockRemoval.blocks.length, 1, "solo debe quedar el bloque B");
    const exerciseAfterRemoval = await customExerciseSchema.findById(materializedExercise._id);
    assert.equal(
      exerciseAfterRemoval.blockId,
      null,
      "blockId debe limpiarse a null cuando su bloque se borra (nunca queda huérfano)"
    );
    ok("updateWorkoutBlocks limpia blockId huérfano al borrar un bloque");

    // --- Fase B: setCustomExerciseBlock — reasignar a un bloque real debe
    // funcionar; a un blockId inexistente debe rechazarse ---
    const reassigned = await customExerciseDao.setCustomExerciseBlock(
      materializedExercise._id.toString(),
      blockB._id.toString()
    );
    assert.equal(reassigned.blockId.toString(), blockB._id.toString());
    ok("setCustomExerciseBlock asigna un blockId válido correctamente");

    await assert.rejects(
      () => customExerciseDao.setCustomExerciseBlock(materializedExercise._id.toString(), new mongoose.Types.ObjectId().toString()),
      /BLOCK_NOT_FOUND|no existe/i,
      "asignar un blockId que no pertenece a este workout debe rechazarse"
    );
    ok("setCustomExerciseBlock rechaza un blockId que no existe en el workout");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.workoutId) {
      // deleteOne (no deleteMany) para disparar el hook en cascada de
      // workout-schema.js que borra los CustomExercise/Set asociados.
      await workoutSchema.deleteOne({ _id: created.workoutId });
    }
    if (created.split) await splitSchema.deleteOne({ _id: created.split._id });
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    // deleteOne (no deleteMany) dispara el hook en cascada de
    // workout-schema.js que borra los CustomExercise/Set de la plantilla.
    if (created.template) await workoutSchema.deleteOne({ _id: created.template._id });
    if (created.relation) await trainerClientSchema.deleteOne({ _id: created.relation._id });
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
