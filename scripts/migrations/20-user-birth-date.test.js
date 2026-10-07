const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateUserBirthDate } = require("./20-user-birth-date");

const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["survey", "wheels", "tokyo", "badZone", "done", "none"].map((key) => [key, db.oid()]));
  await db.raw("users").insertMany([
    // Cuestionario de alta: medianoche UTC exacta, es el día UTC.
    { _id: ids.survey, email: "survey@x.test", birth: new Date("1990-05-05T00:00:00.000Z") },
    // Registro con ruedas en España: la medianoche de Madrid pasada a UTC.
    { _id: ids.wheels, email: "wheels@x.test", birth: new Date("1990-05-04T22:00:00.000Z"), timezone: "Europe/Madrid" },
    // Su zona manda sobre Madrid: medianoche de Tokio.
    { _id: ids.tokyo, email: "tokyo@x.test", birth: new Date("1988-12-31T15:00:00.000Z"), timezone: "Asia/Tokyo" },
    // Zona que no existe: se usa Madrid.
    { _id: ids.badZone, email: "bad-zone@x.test", birth: new Date("2000-01-14T23:00:00.000Z"), timezone: "Mars/Olympus" },
    // Ya migrado y sin fecha: no se tocan.
    { _id: ids.done, email: "done@x.test", birth: "1995-01-01" },
    { _id: ids.none, email: "none@x.test" },
  ]);
  return ids;
}

const birthOf = async (id) => (await db.raw("users").findOne({ _id: id })).birth;

test("cada fecha de nacimiento guardada como Date pasa al día que eligió el usuario", async () => {
  const ids = await seed();
  const stats = await migrateUserBirthDate(db.mongoose.connection.db);
  assert.deepEqual(stats, { users: 4, utcMidnight: 1, inZone: 3, invalid: 0 });

  assert.equal(await birthOf(ids.survey), "1990-05-05");
  assert.equal(await birthOf(ids.wheels), "1990-05-05");
  assert.equal(await birthOf(ids.tokyo), "1989-01-01");
  assert.equal(await birthOf(ids.badZone), "2000-01-15");
  assert.equal(await birthOf(ids.done), "1995-01-01");
  assert.equal(await birthOf(ids.none), undefined);
});

test("idempotente: la segunda pasada no encuentra nada que convertir", async () => {
  await seed();
  await migrateUserBirthDate(db.mongoose.connection.db);
  const before = await db.raw("users").find({}).sort({ email: 1 }).toArray();
  assert.deepEqual(await migrateUserBirthDate(db.mongoose.connection.db), { users: 0, utcMidnight: 0, inZone: 0, invalid: 0 });
  assert.deepEqual(await db.raw("users").find({}).sort({ email: 1 }).toArray(), before);
});

test("dry-run cuenta lo que haría sin escribir", async () => {
  const ids = await seed();
  const stats = await migrateUserBirthDate(db.mongoose.connection.db, { dryRun: true });
  assert.equal(stats.users, 4);
  assert.ok((await birthOf(ids.wheels)) instanceof Date, "sigue siendo Date");
  assert.equal(await db.raw("users").countDocuments({ birth: { $type: "date" } }), 4);
});
