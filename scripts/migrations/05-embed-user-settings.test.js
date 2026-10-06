const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const nutritionPreferencesDao = require("../../components/nutritionPreferences/nutrition-preferences-dao");
const paymentDao = require("../../components/trainerPayments/trainer-payment-dao");
const intakeConfigService = require("../../components/trainerIntakeConfig/trainer-intake-config-service");
const { migrateEmbedUserSettings } = require("./05-embed-user-settings");

// Datos en el formato ANTERIOR (una colección por ajuste), sembrados en crudo.
const db = useTestDb();

async function seedOldFormat() {
  const ids = { client: db.oid(), trainer: db.oid(), ghost: db.oid() };
  await db.raw("users").insertMany([
    { _id: ids.client, email: "c@test.es", roles: ["user"] },
    { _id: ids.trainer, email: "t@test.es", roles: ["trainer"] },
  ]);
  await db.raw("clientnutritionpreferences").insertMany([
    {
      clientId: ids.client,
      allergies: "Frutos secos",
      dietaryFlags: ["vegetarian"],
      mealSlotLabels: { Almuerzo: "Media mañana" },
      requestedBy: ids.trainer,
      requestedAt: new Date("2026-09-01"),
      respondedAt: new Date("2026-09-02"),
      updatedAt: new Date("2026-09-02"),
      __v: 0,
    },
    { clientId: ids.ghost, allergies: "huérfano", updatedAt: new Date() },
  ]);
  await db.raw("trainerpaymentsettings").insertOne({
    trainerId: ids.trainer,
    timeZone: "America/Mexico_City",
    time: "08:30",
    offsets: [-2, 0],
    revision: 3,
    history: [{ at: new Date("2026-09-01"), timeZone: "Europe/Madrid", time: "09:00", offsets: [0] }],
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-09-01"),
  });
  ids.question = db.oid();
  await db.raw("trainerintakeconfigs").insertOne({
    trainerId: ids.trainer,
    enabledFields: ["goals", "equipment"],
    customQuestions: [{ _id: ids.question, label: "¿Turnos de noche?", enabled: true }],
    lastScopes: ["nutrition"],
    updatedAt: new Date("2026-09-01"),
    __v: 0,
  });
  ids.goal = db.oid();
  await db.raw("nutritionalgoals").insertOne({ _id: ids.goal, userId: ids.client, name: "Definición", kcalTotal: 1900, assignedByTrainerId: ids.trainer, __v: 0 });
  return ids;
}

test("dry-run cuenta lo que haría y no escribe nada", async () => {
  await db.reset();
  const ids = await seedOldFormat();
  const stats = await migrateEmbedUserSettings(db.mongoose.connection.db, { dryRun: true });
  assert.deepEqual(stats.nutritionPreferences, { read: 2, embedded: 1, alreadyCurrent: 0, missingUser: 1 });
  assert.deepEqual(stats.paymentSettings, { read: 1, embedded: 1, alreadyCurrent: 0, missingUser: 0 });
  assert.deepEqual(stats.intakeConfig, { read: 1, embedded: 1, alreadyCurrent: 0, missingUser: 0 });
  assert.deepEqual(stats.nutritionalGoals, { read: 1, embedded: 1, alreadyCurrent: 0, missingUser: 0 });
  assert.equal(await nutritionPreferencesDao.getByClientId(ids.client), null);
});

test("migra al usuario, la app lo lee igual, relanzar solo pisa lo más nuevo y --drop-old borra lo viejo", async () => {
  await db.reset();
  const ids = await seedOldFormat();
  const conn = db.mongoose.connection.db;
  await migrateEmbedUserSettings(conn);

  const prefs = await nutritionPreferencesDao.getByClientId(ids.client);
  assert.equal(String(prefs.clientId), String(ids.client));
  assert.equal(prefs.allergies, "Frutos secos");
  assert.deepEqual(prefs.dietaryFlags, ["vegetarian"]);
  assert.equal(prefs.mealSlotLabels.Almuerzo, "Media mañana");
  assert.equal(String(prefs.requestedBy), String(ids.trainer));
  assert.equal(prefs.favoriteFoods, "", "valor por defecto en lo que no estaba");

  const settings = await paymentDao.findSettings(ids.trainer);
  assert.deepEqual([settings.timeZone, settings.time, settings.revision, settings.history.length], ["America/Mexico_City", "08:30", 3, 1]);
  assert.equal(String(settings.trainerId), String(ids.trainer));

  const intake = await intakeConfigService.getMyConfig(ids.trainer);
  assert.deepEqual(intake.enabledFields, ["goals", "equipment"]);
  assert.deepEqual(
    intake.customQuestions.map((q) => [String(q._id), q.label, q.enabled]),
    [[String(ids.question), "¿Turnos de noche?", true]],
    "conserva el id de la pregunta (el tipo lo pone migrate-trainer-client-pairs)"
  );
  assert.deepEqual(intake.lastScopes, ["nutrition"]);

  // Lo que se escriba ya en el usuario (app nueva) no lo pisa una segunda pasada...
  await nutritionPreferencesDao.upsertOwnResponse(ids.client, { allergies: "Ninguna" });
  await paymentDao.saveSettings(ids.trainer, { timeZone: "Europe/Madrid", time: "10:00", offsets: [0] }, new Date());
  let again = await migrateEmbedUserSettings(conn);
  assert.equal(again.nutritionPreferences.embedded + again.paymentSettings.embedded, 0);
  assert.equal((await nutritionPreferencesDao.getByClientId(ids.client)).allergies, "Ninguna");
  assert.equal((await paymentDao.findSettings(ids.trainer)).revision, 4);

  // ...pero lo que la app vieja escribió después en la colección antigua, sí.
  await db.raw("trainerpaymentsettings").updateOne({ trainerId: ids.trainer }, { $set: { time: "07:00", revision: 9 } });
  again = await migrateEmbedUserSettings(conn);
  assert.equal(again.paymentSettings.embedded, 1);
  assert.equal((await paymentDao.findSettings(ids.trainer)).time, "07:00");

  const dry = await migrateEmbedUserSettings(conn, { dropOld: true, dryRun: true });
  assert.deepEqual(dry.dropped, [], "en seco nunca se borra");
  const dropped = await migrateEmbedUserSettings(conn, { dropOld: true });
  assert.deepEqual(dropped.dropped.sort(), ["clientnutritionpreferences", "nutritionalgoals", "trainerintakeconfigs", "trainerpaymentsettings"]);
  const goal = (await db.raw("users").findOne({ _id: ids.client })).nutritionalGoals[0];
  assert.deepEqual([String(goal._id), goal.name, goal.kcalTotal, goal.assignedByTrainerId], [String(ids.goal), "Definición", 1900, undefined]);
  assert.equal((await paymentDao.findSettings(ids.trainer)).time, "07:00", "los usuarios conservan lo migrado");
});
