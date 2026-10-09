const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateExpectedWeight } = require("./27-expected-weight");

const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["planned", "done", "clean", "pending", "doneSet", "both", "empty"].map((key) => [key, db.oid()]));
  await db.raw("workouts").insertMany([
    {
      _id: ids.planned,
      name: "Pautada",
      __v: 3,
      exercises: [
        {
          _id: db.oid(),
          sets: [
            { _id: ids.pending, weight: 40, expectedReps: [8, 10], order: 0 },
            { _id: ids.doneSet, weight: 42.5, reps: 9, doned: true, order: 1 },
            { _id: ids.both, weight: 50, expectedWeight: 45, order: 2 },
            { _id: ids.empty, expectedReps: [12], order: 3 },
          ],
        },
      ],
    },
    { _id: ids.done, name: "Hecha", exercises: [{ _id: db.oid(), sets: [{ _id: db.oid(), weight: 60, reps: 8, doned: true }] }] },
    { _id: ids.clean, name: "Sin carga", exercises: [{ _id: db.oid(), sets: [{ _id: db.oid(), reps: 8 }] }] },
  ]);
  return ids;
}

const setsOf = async (id) => (await db.raw("workouts").findOne({ _id: id })).exercises.flatMap((exercise) => exercise.sets);

test("la carga de una serie sin hacer pasa a expectedWeight; lo levantado no se toca", async () => {
  const ids = await seed();

  assert.deepEqual(await migrateExpectedWeight(db.mongoose.connection.db), { workouts: 1, sets: 2 });

  const [pending, doneSet, both, empty] = await setsOf(ids.planned);
  assert.equal(pending.expectedWeight, 40);
  assert.equal("weight" in pending, false, "la pauta deja de estar en el campo de lo levantado");
  assert.deepEqual(pending.expectedReps, [8, 10]);
  assert.equal(doneSet.weight, 42.5, "serie hecha: weight es lo levantado");
  assert.equal("expectedWeight" in doneSet, false);
  assert.equal(both.expectedWeight, 45, "una pauta que ya existía manda");
  assert.equal("weight" in both, false);
  assert.deepEqual(empty, { _id: ids.empty, expectedReps: [12], order: 3 });

  assert.equal((await db.raw("workouts").findOne({ _id: ids.planned })).__v, 4, "sube la versión para la concurrencia optimista");
  assert.equal((await setsOf(ids.done))[0].weight, 60);
  assert.equal((await db.raw("workouts").findOne({ _id: ids.done })).__v, undefined, "lo que no cambia no se reescribe");
});

test("idempotente, y el dry-run cuenta sin escribir", async () => {
  const ids = await seed();
  const dry = await migrateExpectedWeight(db.mongoose.connection.db, { dryRun: true });
  assert.deepEqual(dry, { workouts: 1, sets: 2 });
  assert.equal((await setsOf(ids.planned))[0].weight, 40, "el dry-run no escribe");

  await migrateExpectedWeight(db.mongoose.connection.db);
  assert.deepEqual(await migrateExpectedWeight(db.mongoose.connection.db), { workouts: 0, sets: 0 });
});
