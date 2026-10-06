const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
require("../../components/users/user-schema");
const { routineInUseOfId } = require("../../components/routineAssignments/routine-in-use");
const { todayIsoDate, addDaysToIsoDate } = require("../../components/util/date-util");
const { migratePhaseChains } = require("./17-phase-chains");

const db = useTestDb();

test("los punteros de rutina pasan a elecciones con fecha y la rutina en uso sigue siendo la misma; fuera el estado de las cadenas", async () => {
  await db.reset();
  const today = todayIsoDate("Europe/Madrid");
  const day = (offset) => addDaysToIsoDate(today, offset);
  const [pending, fromPhase, chose, noPhase, trainer] = Array.from({ length: 5 }, () => db.oid());
  const [phaseTable, otherTable, ownTable, workout] = Array.from({ length: 4 }, () => db.oid());
  const old = new Date(Date.now() - 30 * 86400000);

  await db.raw("users").insertMany([
    // La fase empezó hoy y la app vieja aún no la había puesto en uso.
    { _id: pending, email: "p@x.test", timezone: "Europe/Madrid", tableInUse: otherTable, workoutInUse: workout },
    // La fase ya se puso en uso: el puntero ES la fase.
    { _id: fromPhase, email: "f@x.test", timezone: "Europe/Madrid", tableInUse: phaseTable, workoutInUse: workout },
    // Cambió de rutina a mano después de que la fase entrara en vigor.
    { _id: chose, email: "c@x.test", timezone: "Europe/Madrid", tableInUse: ownTable },
    // Sin entrenador.
    { _id: noPhase, email: "n@x.test", tableInUse: ownTable, workoutInUse: workout },
  ]);
  const routines = db.raw("routineassignments");
  await routines.dropIndexes().catch(() => {});
  await routines.createIndex({ clientId: 1, status: 1, startDate: 1 });
  await routines.insertMany([
    { clientId: pending, trainerId: trainer, tableId: phaseTable, startDate: day(0), status: "active", supersededBy: null, activatedAt: null, createdAt: old },
    { clientId: fromPhase, trainerId: trainer, tableId: otherTable, startDate: day(-20), status: "superseded", supersededBy: db.oid(), activatedAt: old, createdAt: old },
    { clientId: fromPhase, trainerId: trainer, tableId: phaseTable, startDate: day(-5), status: "active", supersededBy: null, activatedAt: old, createdAt: old },
    { clientId: chose, trainerId: trainer, tableId: phaseTable, startDate: day(-5), status: "active", supersededBy: null, activatedAt: old, createdAt: old },
  ]);
  await db.raw("dietphases").insertOne({ clientId: chose, trainerId: trainer, name: "F", startDate: day(-5), endDate: null, status: "active", supersededBy: null, contents: [] });
  const conn = db.mongoose.connection.db;

  const preview = await migratePhaseChains(conn, { dryRun: true });
  assert.deepEqual(
    [preview.pendingActivation, preview.pointerWasPhase, preview.choices, preview.workoutsKept, preview.routineStateFields, preview.dietStateFields],
    [1, 1, 2, 2, 4, 1],
  );
  assert.equal((await db.raw("users").findOne({ _id: pending })).tableInUse.toString(), otherTable.toString(), "en seco no escribe");

  const stats = await migratePhaseChains(conn);
  assert.deepEqual(stats.droppedIndexes, ["routineassignments.clientId_1_status_1_startDate_1"]);

  const inUse = async (id) => {
    const routine = await routineInUseOfId(id);
    return [String(routine.tableInUse || ""), String(routine.workoutInUse || "")];
  };
  assert.deepEqual(await inUse(pending), [String(phaseTable), ""], "la fase pendiente pasa a mandar y la sesión de la rutina anterior se suelta");
  assert.deepEqual(await inUse(fromPhase), [String(phaseTable), String(workout)]);
  assert.equal((await db.raw("users").findOne({ _id: fromPhase })).tableInUse, undefined, "no era una elección");
  assert.deepEqual(await inUse(chose), [String(ownTable), ""]);
  assert.deepEqual(await inUse(noPhase), [String(ownTable), String(workout)]);

  for (const doc of await routines.find({}).toArray()) {
    assert.deepEqual(["status" in doc, "supersededBy" in doc, "activatedAt" in doc], [false, false, false]);
  }
  const diet = await db.raw("dietphases").findOne({ clientId: chose });
  assert.deepEqual(["status" in diet, "supersededBy" in diet], [false, false]);

  const again = await migratePhaseChains(conn);
  assert.deepEqual(
    [again.pendingActivation, again.pointerWasPhase, again.choices, again.workoutsKept, again.routineStateFields, again.dietStateFields],
    [0, 0, 0, 0, 0, 0],
  );
});
