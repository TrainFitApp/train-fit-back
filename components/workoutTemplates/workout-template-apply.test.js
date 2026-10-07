const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../workouts/workout-schema");
const Table = require("../tables/table-schema");
const Exercise = require("../exercises/exercise-schema");
const WorkoutTemplate = require("./workout-template-schema");
const workoutTemplateService = require("./workout-template-service");

// Aplicar una plantilla = un entrenamiento nuevo en TODOS los microciclos,
// con los mismos bloques (_id nuevos, los mismos en toda la fila). Contra un
// Mongo efímero.
const db = useTestDb();

const str = (value) => String(value?._id ?? value);

async function seed({ splits = 2 } = {}) {
  await db.reset();
  const press = await Exercise.create({ name: "Press" });
  const curl = await Exercise.create({ name: "Curl" });
  const blockId = db.oid();
  const template = await WorkoutTemplate.create({
    trainerId: db.oid(),
    name: "Empuje",
    blocks: [{ _id: blockId, name: "Superserie", type: "superset", order: 0 }],
    exercises: [
      { exercise: press._id, blockId, order: 0, sets: [{ expectedReps: [8, 10] }, { expectedReps: [8, 10] }] },
      { exercise: curl._id, order: 1, sets: [{ expectedReps: [12] }] },
    ],
  });
  const clientId = db.oid();
  const table = await Table.create({
    name: "Rutina",
    userId: clientId,
    splits: Array.from({ length: splits }, (_, index) => ({ name: `M${index + 1}`, workouts: [] })),
  });
  return { template, table, clientId };
}

test("applyToTable crea la sesión en todos los microciclos con los mismos bloques", async () => {
  const { template, table, clientId } = await seed();

  const splits = await workoutTemplateService.applyToTable(template, table._id, clientId);
  assert.deepEqual(splits.map((split) => split.workouts.length), [1, 1]);

  const created = await Promise.all(splits.map((split) => Workout.findById(split.workouts[0]._id).lean()));
  const [first, second] = created;
  assert.equal(first.name, "Empuje");
  // La superserie y, para los ejercicios sueltos, un bloque normal
  // (buildBlockFromWorkout: en una plantilla todo ejercicio va en un bloque).
  assert.deepEqual(first.blocks.map((block) => block.type), ["superset", "straight"]);
  assert.deepEqual(second.blocks.map(str), first.blocks.map(str), "mismos _id de bloque en toda la fila");
  const blockIds = first.blocks.map(str);
  for (const workout of created) {
    assert.deepEqual(workout.exercises.map((exercise) => str(exercise.blockId)), blockIds);
    assert.equal(workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0), 3, "con sus series");
  }
  assert.notEqual(str(first.exercises[0]), str(second.exercises[0]), "cada microciclo con sus propios ejercicios");
  assert.ok(!blockIds.includes(str(template.blocks[0])), "la fila no comparte bloques con la plantilla");
});

test("applyToTable rechaza la rutina de otro cliente o sin microciclos", async () => {
  const { template, table } = await seed();
  await assert.rejects(workoutTemplateService.applyToTable(template, table._id, db.oid()), { code: "TABLE_FORBIDDEN" });
  await assert.rejects(workoutTemplateService.applyToTable(template, db.oid(), db.oid()), { code: "TABLE_NOT_FOUND" });

  const empty = await seed({ splits: 0 });
  await assert.rejects(workoutTemplateService.applyToTable(empty.template, empty.table._id, empty.clientId), {
    code: "TABLE_WITHOUT_SPLITS",
  });
});
