const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { loadAllSchemas } = require("../../components/util/account-cascade");
const { migrateNormalizeEmails } = require("./24-normalize-emails");

// La cascada de borrado recorre todos los modelos: cargados antes de arrancar.
loadAllSchemas();
const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["lone", "spaced", "upper", "twin", "older", "newer"].map((key) => [key, db.oid()]));
  // En el orden de los _id: `older` antes que `newer`.
  [ids.older, ids.newer] = [db.oid("0000000000000000000000a1"), db.oid("0000000000000000000000a2")];
  await db.raw("users").insertMany([
    { _id: ids.lone, email: "Lone@Example.test", name: "Sola", __v: 0 },
    { _id: ids.spaced, email: " spaced@example.test ", name: "Espacios", __v: 0 },
    { _id: ids.upper, email: "Twin@Example.test", name: "Duplicada", __v: 0 },
    { _id: ids.twin, email: "twin@example.test", name: "Buena", __v: 0 },
    { _id: ids.older, email: "Pair@Example.test", name: "Antigua", __v: 0 },
    { _id: ids.newer, email: "PAIR@example.test", name: "Nueva", __v: 0 },
  ]);
  await db.raw("anthropometries").insertMany([
    { userId: ids.upper, date: "2026-08-08", weight: 80 },
    { userId: ids.twin, date: "2026-08-08", weight: 81 },
  ]);
  return ids;
}

const user = (_id) => db.raw("users").findOne({ _id });

test("normaliza las cuentas sin gemela y borra con su cascada las que duplican otra", async () => {
  const ids = await seed();

  const stats = await migrateNormalizeEmails(db.mongoose.connection.db);

  assert.deepEqual(stats, { normalized: 3, deletedDuplicates: 2 });
  assert.equal((await user(ids.lone)).email, "lone@example.test");
  assert.equal((await user(ids.lone)).__v, 1, "sube la versión para la concurrencia optimista");
  assert.equal((await user(ids.spaced)).email, "spaced@example.test");
  assert.equal(await user(ids.upper), null, "la duplicada se borra");
  assert.equal((await user(ids.twin)).email, "twin@example.test", "la que ya estaba bien no se toca");
  assert.equal(await db.raw("anthropometries").countDocuments({ userId: ids.upper }), 0, "con sus datos");
  assert.equal(await db.raw("anthropometries").countDocuments({ userId: ids.twin }), 1);
  assert.equal((await user(ids.older)).email, "pair@example.test", "entre dos sin normalizar, se queda la más antigua");
  assert.equal(await user(ids.newer), null);
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  const dry = await migrateNormalizeEmails(nativeDb, { dryRun: true });
  assert.equal(dry.deletedDuplicates, 1, "dry-run: solo ve la gemela que ya existe");
  assert.equal((await user(ids.lone)).email, "Lone@Example.test");
  assert.ok(await user(ids.upper));

  await migrateNormalizeEmails(nativeDb);
  assert.deepEqual(await migrateNormalizeEmails(nativeDb), { normalized: 0, deletedDuplicates: 0 });
});
