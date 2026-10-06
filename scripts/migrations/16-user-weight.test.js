const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const anthropometryDao = require("../../components/anthropometry/anthropometry-dao");
const { migrateUserWeight } = require("./16-user-weight");

const db = useTestDb();

test("el peso del perfil pasa a una medida del día de alta si no tenía ninguna; users.weight desaparece", async () => {
  await db.reset();
  const signupOnly = db.oid("650000000000000000000001"); // alta el 2023-09-12 (Madrid)
  const measured = db.oid();
  const broken = db.oid();
  await db.raw("users").insertMany([
    { _id: signupOnly, email: "a@x.test", weight: 82.5 },
    { _id: measured, email: "b@x.test", weight: 70 },
    { _id: broken, email: "c@x.test", weight: "setenta" },
  ]);
  await db.raw("anthropometries").insertMany([
    { userId: measured, date: "2026-09-01", weight: 71.2 },
    { userId: signupOnly, date: "2023-09-12", waist: 90 },
  ]);
  const conn = db.mongoose.connection.db;

  assert.deepEqual(await migrateUserWeight(conn, { dryRun: true }),
    { users: 3, seeded: 1, alreadyMeasured: 1, differentFromLatest: 1, invalid: 1 });
  assert.equal((await db.raw("users").findOne({ _id: signupOnly })).weight, 82.5, "en seco no escribe");

  await migrateUserWeight(conn);
  assert.deepEqual(await anthropometryDao.findLatestWeight(signupOnly), { weight: 82.5, date: "2023-09-12" });
  assert.equal((await db.raw("anthropometries").findOne({ userId: signupOnly })).waist, 90, "se suma a la medida de ese día");
  assert.deepEqual(await anthropometryDao.findLatestWeight(measured), { weight: 71.2, date: "2026-09-01" }, "lo medido manda");
  assert.equal(await db.raw("users").countDocuments({ weight: { $exists: true } }), 0);

  assert.deepEqual(await migrateUserWeight(conn), { users: 0, seeded: 0, alreadyMeasured: 0, differentFromLatest: 0, invalid: 0 });
});
