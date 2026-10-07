const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateRetiredFields } = require("./23-retired-fields");

const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["user", "legacy", "both", "current", "template", "other", "response", "measure", "product"].map((key) => [key, db.oid()]));
  await db.raw("users").insertMany([
    {
      _id: ids.user,
      email: "u@x.test",
      lastPasswordChangeAt: new Date(),
      nutritionPreferences: { allergies: "nueces", disabledMealSlots: ["Recena"], mealSlotLabels: { Almuerzo: "Media mañana" } },
    },
  ]);
  await db.raw("coachprotocols").insertMany([
    { _id: ids.legacy, name: "Solo plantilla", checkinTemplateId: ids.template, checkins: [] },
    { _id: ids.both, name: "Con lista", checkinTemplateId: ids.template, checkins: [{ templateId: ids.other, frequency: "daily", interval: 1, time: "08:00" }] },
    { _id: ids.current, name: "Actual", checkins: [{ templateId: ids.other, frequency: "weekly", interval: 2, time: "10:00" }] },
  ]);
  await db.raw("checkinresponses").insertOne({ _id: ids.response, values: { weight: 80 }, seenByTrainer: false });
  await db.raw("anthropometries").insertOne({ _id: ids.measure, date: "2026-10-01", weight: 80, checkinSources: [db.oid()] });
  await db.raw("products").insertOne({ _id: ids.product, name: "Yogur", nutriscoreScore: 2, nutriscoreGrade: "a" });
  return ids;
}

const find = (collection, _id) => db.raw(collection).findOne({ _id });

test("pasa el check-in suelto de un protocolo a su lista y quita los campos retirados", async () => {
  const ids = await seed();

  const stats = await migrateRetiredFields(db.mongoose.connection.db);
  assert.deepEqual(stats, {
    protocols: 2,
    protocolCheckinsMoved: 1,
    users: 1,
    checkinresponses: 1,
    anthropometries: 1,
    products: 1,
  });

  const legacy = await find("coachprotocols", ids.legacy);
  assert.equal("checkinTemplateId" in legacy, false);
  assert.deepEqual(legacy.checkins, [{ templateId: ids.template, frequency: "weekly", interval: 1, time: "09:00" }]);
  const both = await find("coachprotocols", ids.both);
  assert.equal("checkinTemplateId" in both, false);
  assert.equal(String(both.checkins[0].templateId), String(ids.other), "la lista que ya tenía manda");
  assert.equal((await find("coachprotocols", ids.current)).checkins[0].interval, 2, "lo actual no se toca");

  const user = await find("users", ids.user);
  assert.equal("lastPasswordChangeAt" in user, false);
  assert.deepEqual(user.nutritionPreferences, { allergies: "nueces", disabledMealSlots: ["Recena"] });
  assert.equal(user.__v, 1, "sube la versión para la concurrencia optimista");
  assert.equal("seenByTrainer" in (await find("checkinresponses", ids.response)), false);
  assert.equal("checkinSources" in (await find("anthropometries", ids.measure)), false);
  const product = await find("products", ids.product);
  assert.equal("nutriscoreScore" in product || "nutriscoreGrade" in product, false);
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  const dry = await migrateRetiredFields(nativeDb, { dryRun: true });
  assert.equal(dry.protocols, 2);
  assert.equal(dry.users, 1);
  assert.ok((await find("coachprotocols", ids.legacy)).checkinTemplateId, "dry-run: sin cambios");

  await migrateRetiredFields(nativeDb);
  assert.deepEqual(await migrateRetiredFields(nativeDb), {
    protocols: 0,
    protocolCheckinsMoved: 0,
    users: 0,
    checkinresponses: 0,
    anthropometries: 0,
    products: 0,
  });
});
