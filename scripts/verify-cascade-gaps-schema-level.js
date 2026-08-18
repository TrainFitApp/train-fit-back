const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-cascade-gaps-schema-level]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Confirma las 3 cascadas padre->hijo añadidas hoy (huecos preexistentes):
// PlanAssignment -> DietException, Table -> PinnedExerciseNote,
// TrainerTask -> TaskCompletion. Prueba deleteOne en cada una.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const planAssignmentSchema = require("../components/planAssignments/plan-assignment-schema");
  const dietExceptionSchema = require("../components/dietExceptions/diet-exception-schema");
  const tableSchema = require("../components/tables/table-schema");
  const pinnedExerciseNoteSchema = require("../components/pinnedExerciseNotes/pinned-exercise-note-schema");
  const trainerTaskSchema = require("../components/trainerTasks/trainer-task-schema");
  const taskCompletionSchema = require("../components/trainerTasks/task-completion-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, client: null, assignment: null, exception: null, table: null, pinnedNote: null, task: null, completion: null };

  try {
    created.trainer = await userSchema.create({ email: `verify-cascade-trainer-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-cascade-client-${runId}@test.local` });
    ok("trainer/cliente de prueba creados");

    // --- 1) PlanAssignment -> DietException ---
    created.assignment = await planAssignmentSchema.create({
      planId: new mongoose.Types.ObjectId(),
      clientId: created.client._id,
      trainerId: created.trainer._id,
      startDate: "2026-01-01",
      endMode: "indefinite",
    });
    created.exception = await dietExceptionSchema.create({
      assignmentId: created.assignment._id,
      clientId: created.client._id,
      date: "2026-01-05",
      action: "skip",
    });
    await planAssignmentSchema.deleteOne({ _id: created.assignment._id });
    const exceptionAfter = await dietExceptionSchema.findById(created.exception._id);
    assert.equal(exceptionAfter, null, "DietException debe borrarse en cascada al borrar su PlanAssignment");
    ok("PlanAssignment -> DietException cascada correctamente");
    created.assignment = null;
    created.exception = null;

    // --- 2) Table -> PinnedExerciseNote ---
    created.table = await tableSchema.create({ name: "Tabla verificación", userId: created.client._id, splits: [] });
    created.pinnedNote = await pinnedExerciseNoteSchema.create({
      tableId: created.table._id,
      workoutIndex: 0,
      exerciseIndex: 0,
      notes: "nota de prueba",
    });
    await tableSchema.deleteOne({ _id: created.table._id });
    const noteAfter = await pinnedExerciseNoteSchema.findById(created.pinnedNote._id);
    assert.equal(noteAfter, null, "PinnedExerciseNote debe borrarse en cascada al borrar su Table");
    ok("Table -> PinnedExerciseNote cascada correctamente");
    created.table = null;
    created.pinnedNote = null;

    // --- 3) TrainerTask -> TaskCompletion ---
    created.task = await trainerTaskSchema.create({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      type: "steps",
      target: 10000,
      unit: "pasos",
    });
    created.completion = await taskCompletionSchema.create({ taskId: created.task._id, date: "2026-01-05" });
    await trainerTaskSchema.deleteOne({ _id: created.task._id });
    const completionAfter = await taskCompletionSchema.findById(created.completion._id);
    assert.equal(completionAfter, null, "TaskCompletion debe borrarse en cascada al borrar su TrainerTask");
    ok("TrainerTask -> TaskCompletion cascada correctamente");
    created.task = null;
    created.completion = null;

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.exception) await dietExceptionSchema.deleteOne({ _id: created.exception._id });
    if (created.assignment) await planAssignmentSchema.deleteOne({ _id: created.assignment._id });
    if (created.pinnedNote) await pinnedExerciseNoteSchema.deleteOne({ _id: created.pinnedNote._id });
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.completion) await taskCompletionSchema.deleteOne({ _id: created.completion._id });
    if (created.task) await trainerTaskSchema.deleteOne({ _id: created.task._id });
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
