const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { INTAKE_FIELD_KEYS } = require("../../components/trainerIntakeConfig/intake-field-catalog");
const { migrateIntakeForms } = require("./21-intake-forms");

const db = useTestDb();

test("cada par sin formulario recibe la copia de la configuración actual de su profesional", async () => {
  await db.reset();
  const ids = Object.fromEntries(["coach", "plain", "question", "off", "video", "ana", "bea", "carla", "done"].map((key) => [key, db.oid()]));
  await db.raw("users").insertMany([
    {
      _id: ids.coach,
      email: "coach@x.test",
      roles: ["trainer"],
      trainerSettings: {
        intake: {
          enabledFields: ["goals", "equipment"],
          customQuestions: [
            { _id: ids.question, label: "¿Turnos?", type: "yes_no", unit: "", options: [], required: true, enabled: true },
            { _id: ids.off, label: "Desactivada", type: "text", unit: "", options: [], required: false, enabled: false },
          ],
          measurements: [{ key: "perimeter_waist", required: true }],
          photos: { poses: ["front", "side"], required: false },
          videos: [{ _id: ids.video, label: "Sentadilla de perfil", required: true, enabled: true }],
          lastScopes: ["training"],
        },
      },
    },
    // Nunca guardó configuración: todos los campos y nada más.
    { _id: ids.plain, email: "plain@x.test", roles: ["trainer"] },
  ]);
  const invitedAt = new Date("2026-09-01T10:00:00Z");
  const existingForm = { enabledFields: ["goals"], customQuestions: [], measurements: [], photos: null, videos: [], sentAt: invitedAt };
  await db.raw("trainerclients").insertMany([
    { trainerId: ids.coach, clientId: ids.ana, clientEmail: "ana@x.test", intakePending: true,
      scopes: [{ _id: db.oid(), scope: "training", status: "active", invitedAt }] },
    { trainerId: ids.coach, clientEmail: "bea@x.test", intakeForm: null,
      scopes: [{ _id: db.oid(), scope: "nutrition", status: "pending", invitedAt: new Date("2026-09-20T10:00:00Z") }] },
    { trainerId: ids.plain, clientId: ids.carla, clientEmail: "carla@x.test", scopes: [] },
    { trainerId: ids.coach, clientId: ids.done, clientEmail: "done@x.test", intakeForm: existingForm, scopes: [] },
  ]);
  const conn = db.mongoose.connection.db;
  const now = new Date("2026-10-06T08:00:00Z");

  assert.deepEqual(await migrateIntakeForms(conn, { dryRun: true, now }), { pairs: 3, fromConfig: 2, withoutConfig: 1 });
  assert.equal(await db.raw("trainerclients").countDocuments({ intakeForm: { $type: "object" } }), 1, "en seco no escribe");

  await migrateIntakeForms(conn, { now });
  const ana = await db.raw("trainerclients").findOne({ clientEmail: "ana@x.test" });
  assert.deepEqual(ana.intakeForm.enabledFields, ["goals", "equipment"]);
  assert.deepEqual(
    ana.intakeForm.customQuestions.map((q) => [String(q._id), q.label, q.required]),
    [[String(ids.question), "¿Turnos?", true]],
    "solo las preguntas activas, con su _id"
  );
  assert.deepEqual(ana.intakeForm.measurements, [{ key: "perimeter_waist", required: true }]);
  assert.deepEqual(ana.intakeForm.photos, { poses: ["front", "side"], required: false });
  assert.deepEqual(ana.intakeForm.videos.map((v) => [String(v._id), v.label, v.required]), [[String(ids.video), "Sentadilla de perfil", true]]);
  assert.deepEqual(ana.intakeForm.sentAt, invitedAt, "fecha de su última invitación");

  const bea = await db.raw("trainerclients").findOne({ clientEmail: "bea@x.test" });
  assert.deepEqual(bea.intakeForm.sentAt, new Date("2026-09-20T10:00:00Z"));

  const carla = await db.raw("trainerclients").findOne({ clientEmail: "carla@x.test" });
  assert.deepEqual(carla.intakeForm.enabledFields, INTAKE_FIELD_KEYS);
  assert.deepEqual([carla.intakeForm.customQuestions, carla.intakeForm.measurements, carla.intakeForm.videos], [[], [], []]);
  assert.equal(carla.intakeForm.photos, null);
  assert.deepEqual(carla.intakeForm.sentAt, now, "sin invitaciones, la fecha de la migración");

  const done = await db.raw("trainerclients").findOne({ clientEmail: "done@x.test" });
  assert.deepEqual(done.intakeForm, existingForm, "la copia que ya tenía no se toca");

  assert.deepEqual(await migrateIntakeForms(conn, { now }), { pairs: 0, fromConfig: 0, withoutConfig: 0 });
});
