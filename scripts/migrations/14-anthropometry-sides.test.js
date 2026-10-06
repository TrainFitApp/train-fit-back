const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateAnthropometrySides } = require("./14-anthropometry-sides");

const db = useTestDb();

test("el perímetro sin lado pasa a cada lado vacío, sin pisar lo que ya tenía lado, y desaparece; idempotente", async () => {
  await db.reset();
  const [onlySingle, mixed, sided] = [db.oid(), db.oid(), db.oid()];
  const userId = db.oid();
  await db.raw("anthropometries").insertMany([
    { _id: onlySingle, userId, date: "2026-09-01", bicepsRelaxed: 36, calf: 38 },
    { _id: mixed, userId, date: "2026-09-08", bicepsContracted: 39, bicepsContractedL: 40.5, checkinFields: ["bicepsContractedL"] },
    { _id: sided, userId, date: "2026-09-15", calfL: 37, calfR: 37.5 },
  ]);
  const conn = db.mongoose.connection.db;

  assert.deepEqual(await migrateAnthropometrySides(conn, { dryRun: true }), { documents: 2, sidesFilled: 5 });
  assert.equal((await db.raw("anthropometries").findOne({ _id: onlySingle })).bicepsRelaxed, 36, "en seco no escribe");

  await migrateAnthropometrySides(conn);
  const first = await db.raw("anthropometries").findOne({ _id: onlySingle });
  assert.deepEqual([first.bicepsRelaxedL, first.bicepsRelaxedR, first.calfL, first.calfR], [36, 36, 38, 38]);
  assert.equal("bicepsRelaxed" in first || "calf" in first, false);
  const second = await db.raw("anthropometries").findOne({ _id: mixed });
  assert.deepEqual([second.bicepsContractedL, second.bicepsContractedR, "bicepsContracted" in second], [40.5, 39, false], "el lado medido se queda");
  assert.deepEqual(await db.raw("anthropometries").findOne({ _id: sided }, { projection: { _id: 0, calfL: 1, calfR: 1 } }), { calfL: 37, calfR: 37.5 });

  assert.deepEqual(await migrateAnthropometrySides(conn), { documents: 0, sidesFilled: 0 });
});
