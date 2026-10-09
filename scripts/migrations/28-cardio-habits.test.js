const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateCardioHabits } = require("./28-cardio-habits");

const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["cardio", "named", "steps", "protocol", "clean"].map((key) => [key, db.oid()]));
  await db.raw("trainertasks").insertMany([
    { _id: ids.cardio, type: "cardio", label: null, target: 30, unit: "min", active: true },
    { _id: ids.named, type: "cardio", label: "Bici suave", target: 20, unit: "min", active: false },
    { _id: ids.steps, type: "steps", label: null, target: 8000, unit: "pasos", active: true },
  ]);
  await db.raw("taskcompletions").insertOne({ taskId: ids.cardio, date: "2026-10-01", completed: true });
  await db.raw("coachprotocols").insertMany([
    {
      _id: ids.protocol,
      name: "Definición",
      dailyTasks: [
        { type: "steps", label: null, target: 10000, unit: "pasos" },
        { type: "cardio", target: 30, unit: "min" },
        { type: "cardio", label: "Elíptica", target: 25, unit: "min" },
      ],
    },
    { _id: ids.clean, name: "Volumen", dailyTasks: [{ type: "water", label: null, target: 2, unit: "l" }] },
  ]);
  return ids;
}

const find = (collection, _id) => db.raw(collection).findOne({ _id });

test("los hábitos de cardio pasan a hábitos con nombre propio, con su objetivo y su historial", async () => {
  const ids = await seed();

  assert.deepEqual(await migrateCardioHabits(db.mongoose.connection.db), { trainertasks: 2, coachprotocols: 1 });

  const cardio = await find("trainertasks", ids.cardio);
  assert.equal(cardio.type, "custom");
  assert.equal(cardio.label, "Cardio");
  assert.equal(cardio.target, 30);
  assert.equal(cardio.unit, "min");
  const named = await find("trainertasks", ids.named);
  assert.equal(named.type, "custom");
  assert.equal(named.label, "Bici suave", "el nombre que tenía se queda");
  assert.equal((await find("trainertasks", ids.steps)).type, "steps", "los demás tipos no se tocan");
  assert.equal(await db.raw("taskcompletions").countDocuments({ taskId: ids.cardio }), 1, "el cumplimiento se conserva");

  assert.deepEqual(
    (await find("coachprotocols", ids.protocol)).dailyTasks.map(({ type, label, target }) => ({ type, label, target })),
    [
      { type: "steps", label: null, target: 10000 },
      { type: "custom", label: "Cardio", target: 30 },
      { type: "custom", label: "Elíptica", target: 25 },
    ]
  );
  assert.equal((await find("coachprotocols", ids.clean)).dailyTasks[0].type, "water");
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  assert.deepEqual(await migrateCardioHabits(nativeDb, { dryRun: true }), { trainertasks: 2, coachprotocols: 1 });
  assert.equal((await find("trainertasks", ids.cardio)).type, "cardio", "dry-run: sin cambios");
  assert.equal((await find("coachprotocols", ids.protocol)).dailyTasks[1].type, "cardio", "dry-run: sin cambios");

  await migrateCardioHabits(nativeDb);
  assert.deepEqual(await migrateCardioHabits(nativeDb), { trainertasks: 0, coachprotocols: 0 });
});
