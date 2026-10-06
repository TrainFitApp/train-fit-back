const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../workouts/workout-schema");
const setDao = require("./set-dao");

// Series embebidas en su sesión (Workout.exercises[].sets[]). Contra un Mongo
// efímero: lo que importa es lo que queda guardado.
const db = useTestDb();

async function seedWorkout(sets) {
  return Workout.create({ name: "Pierna", exercises: [{ exercise: db.oid(), sets }] });
}

async function savedSets(workoutId) {
  const workout = await Workout.findById(workoutId).lean();
  return workout.exercises[0].sets;
}

test("updateSet — donedAt solo lo fija el backend, en la transición real", async (t) => {
  await db.reset();
  const past = new Date("2020-01-01T10:00:00Z");
  const workout = await seedWorkout([{ reps: 5 }, { reps: 6, doned: true, donedAt: past }]);
  const [pending, done] = workout.exercises[0].sets;

  await t.test("false -> true: fija donedAt", async () => {
    const before = Date.now();
    const set = await setDao.updateSet({ _id: pending._id, doned: true, weight: 100 });
    assert.equal(set.weight, 100);
    assert.ok(new Date(set.donedAt).getTime() >= before);
  });

  await t.test("true -> true (edición no relacionada): NO vuelve a tocar donedAt", async () => {
    const set = await setDao.updateSet({ _id: done._id, doned: true, weight: 105 });
    assert.equal(new Date(set.donedAt).toISOString(), past.toISOString());
  });

  await t.test("el cliente no puede mandar donedAt directamente", async () => {
    const fake = new Date("1999-01-01");
    const set = await setDao.updateSet({ _id: done._id, doned: true, donedAt: fake, weight: 90 });
    assert.equal(new Date(set.donedAt).toISOString(), past.toISOString());
  });

  await t.test("true -> false: limpia donedAt", async () => {
    const set = await setDao.updateSet({ _id: done._id, doned: false });
    assert.equal(set.donedAt, undefined);
    assert.equal(set.doned, false);
  });

  await t.test("solo cambia ESA serie y sube la versión de la sesión", async () => {
    const before = await Workout.findById(workout._id).lean();
    await setDao.updateSet({ _id: pending._id, reps: 8 });
    const after = await Workout.findById(workout._id).lean();
    assert.equal(after.exercises[0].sets[0].reps, 8);
    assert.equal(after.exercises[0].sets[1].reps, 6);
    assert.equal(after.__v, before.__v + 1);
  });
});

test("updateSet — null/[] vacían, los límites del schema se aplican y los campos ajenos se ignoran", async () => {
  await db.reset();
  const workout = await seedWorkout([{ reps: 5, rir: [2], weight: 50 }]);
  const setId = workout.exercises[0].sets[0]._id;

  const set = await setDao.updateSet({ _id: setId, rir: [], weight: null, reps: "7", hacked: true });
  assert.equal(set.reps, 7);
  assert.equal(set.weight, undefined);
  assert.equal(set.rir, undefined);
  assert.equal(set.hacked, undefined);

  await assert.rejects(() => setDao.updateSet({ _id: setId, reps: 5000 }), { name: "ValidationError" });
  assert.equal((await savedSets(workout._id))[0].reps, 7);
});

test("updateSet de una serie que no existe devuelve null", async () => {
  await db.reset();
  assert.equal(await setDao.updateSet({ _id: db.oid(), reps: 3 }), null);
});

test("deleteSet quita la serie y renumera el orden de las que quedan", async () => {
  await db.reset();
  const workout = await seedWorkout([
    { reps: 1, order: 0 },
    { reps: 2, order: 1 },
    { reps: 3, order: 2 },
  ]);
  const middle = workout.exercises[0].sets[1]._id;

  assert.deepEqual(await setDao.deleteSet(middle), { deletedCount: 1 });
  const sets = await savedSets(workout._id);
  assert.deepEqual(sets.map((set) => [set.reps, set.order]), [[1, 0], [3, 1]]);

  assert.deepEqual(await setDao.deleteSet(middle), { deletedCount: 0 });
  assert.deepEqual(await setDao.deleteSet("no-es-un-id"), { deletedCount: 0 });
});
