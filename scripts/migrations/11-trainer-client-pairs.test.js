const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
require("../../components/users/user-schema");
const trainerClientDao = require("../../components/trainerClients/trainer-client-dao");
const { intakeStatusOf } = require("../../components/trainerClients/pair-state");
const { migrateTrainerClientPairs } = require("./11-trainer-client-pairs");

const db = useTestDb();

// Datos con la forma vieja: un documento por scope e invitación, los índices
// de entonces y el cuestionario en su propia colección.
async function seedLegacy() {
  await db.reset();
  const relations = db.raw("trainerclients");
  await relations.dropIndexes().catch(() => {});
  await relations.createIndex(
    { trainerId: 1, clientEmail: 1, scope: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ["pending", "cuestionario_pendiente", "en_revision", "active"] } } }
  );
  await relations.createIndex({ trainerId: 1, clientId: 1, status: 1 });

  const ids = Object.fromEntries(["trainer", "ana", "bea", "rel1", "rel2", "rel3", "rel4", "rel5", "rel6", "intake", "question", "exercise", "video"].map((key) => [key, db.oid()]));
  await db.raw("users").insertMany([
    { _id: ids.trainer, email: "coach@x.test", roles: ["trainer"],
      trainerSettings: { intake: { enabledFields: ["goals"], customQuestions: [{ _id: ids.question, label: "¿Turnos?", enabled: true }] } } },
    { _id: ids.ana, email: "ana@x.test", roles: ["user"] },
    { _id: ids.bea, email: "bea@x.test", roles: ["user"] },
  ]);
  const at = (day) => new Date(Date.UTC(2026, 0, day));
  await relations.insertMany([
    // Ana: entrenamiento terminado, otra vez en curso, y nutrición enviada y "en revisión".
    { _id: ids.rel1, trainerId: ids.trainer, clientId: ids.ana, clientEmail: "ana@x.test", scope: "training", status: "revoked",
      invitedAt: at(1), respondedAt: at(2), revokedAt: at(5), revokedBy: "client", intakePending: false, trainingGoalType: "strength" },
    { _id: ids.rel2, trainerId: ids.trainer, clientId: ids.ana, clientEmail: "ana@x.test", scope: "training", status: "active",
      invitedAt: at(10), respondedAt: at(11), intakePending: false, mediaHistorySharedAt: at(12), mediaHistoryAskedAt: at(12) },
    { _id: ids.rel3, trainerId: ids.trainer, clientId: ids.ana, clientEmail: "ana@x.test", scope: "nutrition", status: "en_revision",
      invitedAt: at(10), respondedAt: at(11), intakePending: false },
    // Bea aceptó pero no ha rellenado el cuestionario (estado retirado).
    { _id: ids.rel4, trainerId: ids.trainer, clientId: ids.bea, clientEmail: "bea@x.test", scope: "nutrition", status: "cuestionario_pendiente",
      invitedAt: at(3), respondedAt: at(4) },
    // Invitación a alguien sin cuenta, y otra que rechazó.
    { _id: ids.rel5, trainerId: ids.trainer, clientEmail: "nuevo@x.test", scope: "training", status: "pending", invitedAt: at(20) },
    { _id: ids.rel6, trainerId: ids.trainer, clientEmail: "nuevo@x.test", scope: "nutrition", status: "declined", invitedAt: at(15), respondedAt: at(16) },
  ]);
  await db.raw("clientintakes").insertOne({
    _id: ids.intake, trainerId: ids.trainer, clientId: ids.ana, goals: "Fuerza", healthConditions: "", experienceLevel: "beginner",
    availability: "3 días", equipment: "Mancuernas en casa", trainingLocation: null, equipmentTags: [],
    customAnswers: [{ questionId: "q1", label: "¿Turnos?", value: "No" }], submittedAt: at(11), reviewedAt: null,
  });
  await db.raw("painthresholds").insertMany([
    { trainerId: ids.trainer, clientId: ids.ana, zone: "Rodilla der.", workLevel: 3, painLevel: 5, note: "Sin sentadilla profunda", createdAt: at(12), updatedAt: at(13) },
    // De una relación que ya no existe: no tiene par al que ir.
    { trainerId: db.oid(), clientId: ids.ana, zone: "Hombro izq.", workLevel: 2, painLevel: 4 },
  ]);
  await db.raw("techniquevideooverrides").insertOne(
    { trainerId: ids.trainer, clientId: ids.ana, exerciseId: ids.exercise, techniqueVideoId: ids.video, createdAt: at(14) }
  );
  return ids;
}

test("cada relación vieja pasa a una entrada de su par, con el cuestionario dentro; idempotente", async () => {
  const ids = await seedLegacy();
  const conn = db.mongoose.connection.db;

  const preview = await migrateTrainerClientPairs(conn, { dryRun: true });
  assert.equal(preview.relations, 6);
  assert.equal(preview.pairs, 3, "Ana, Bea y la persona sin cuenta");
  assert.equal(preview.retiredStatuses, 2);
  assert.deepEqual(preview.painThresholds, { read: 2, embedded: 1, alreadyThere: 0, orphan: 1 });
  assert.equal(await db.raw("trainerclients").countDocuments(), 6, "en seco no escribe");

  const stats = await migrateTrainerClientPairs(conn);
  assert.equal(stats.intakes, 1);
  assert.equal(stats.legacyEquipment, 1);
  assert.equal(stats.typedQuestions, 1);
  assert.deepEqual(stats.painThresholds, { read: 2, embedded: 1, alreadyThere: 0, orphan: 1 });
  assert.deepEqual(stats.techniqueOverrides, { read: 1, embedded: 1, alreadyThere: 0, orphan: 0 });
  const coach = await db.raw("users").findOne({ _id: ids.trainer });
  assert.deepEqual(coach.trainerSettings.intake.customQuestions[0],
    { _id: ids.question, label: "¿Turnos?", type: "text", unit: "", options: [], required: false, enabled: true });
  assert.equal(await db.raw("trainerclients").countDocuments(), 3);

  const ana = await db.raw("trainerclients").findOne({ clientId: ids.ana });
  assert.equal(String(ana._id), String(ids.rel1), "el par toma el id de su documento más antiguo");
  assert.deepEqual(
    ana.scopes.map((link) => [String(link._id), link.scope, link.status]),
    [[String(ids.rel1), "training", "revoked"], [String(ids.rel2), "training", "active"], [String(ids.rel3), "nutrition", "active"]],
    "mismos ids de invitación; en_revision pasa a activa"
  );
  assert.equal(ana.intakePending, false);
  assert.equal(ana.trainingGoalType, "strength");
  assert.deepEqual(ana.mediaHistorySharedAt, new Date(Date.UTC(2026, 0, 12)));
  assert.equal(ana.intake.goals, "Fuerza");
  assert.equal("equipment" in ana.intake, false, "fuera el campo viejo");
  assert.deepEqual(ana.intake.customAnswers.map((answer) => answer.label), ["¿Turnos?", "Material"]);
  assert.equal(ana.intake.customAnswers[1].value, "Mancuernas en casa");
  assert.ok(ana.intake.customAnswers.every((answer) => answer.type === "text"), "las respuestas viejas eran texto");
  assert.equal(intakeStatusOf(ana), "submitted");
  assert.equal("scope" in ana || "status" in ana, false);
  assert.deepEqual(ana.painThresholds.map((t) => [t.zone, t.workLevel, t.painLevel, t.note]), [["Rodilla der.", 3, 5, "Sin sentadilla profunda"]]);
  assert.deepEqual(await trainerClientDao.listTechniqueOverrides({ clientId: ids.ana, trainerId: ids.trainer }).then((list) => list.map((o) => String(o.techniqueVideoId))), [String(ids.video)]);

  const bea = await db.raw("trainerclients").findOne({ clientId: ids.bea });
  assert.equal(bea.scopes[0].status, "active");
  assert.equal(bea.intakePending, true, "cuestionario_pendiente = activa con el cuestionario por enviar");

  const pending = await db.raw("trainerclients").findOne({ clientEmail: "nuevo@x.test" });
  assert.equal("clientId" in pending, false);
  assert.deepEqual(pending.scopes.map((link) => link.status), ["declined", "pending"]);

  // El código nuevo lee el resultado.
  assert.equal(await trainerClientDao.isActivePair(ids.trainer, ids.ana, "nutrition"), true);
  assert.equal(await trainerClientDao.isActivePair(ids.trainer, ids.bea, "training"), false);
  assert.equal((await trainerClientDao.findInvitation(ids.rel5)).invitation.status, "pending");
  assert.deepEqual(await trainerClientDao.countSeats(ids.trainer), { occupied: 2, reserved: 1 });

  const indexes = (await db.raw("trainerclients").indexes()).map((index) => index.name).sort();
  assert.deepEqual(indexes, ["_id_", "clientEmail_1", "clientId_1", "trainerId_1_clientEmail_1", "trainerId_1_clientId_1"]);

  const again = await migrateTrainerClientPairs(conn, { dropOld: true });
  assert.equal(again.relations, 0);
  assert.deepEqual(again.droppedCollections, ["clientintakes", "painthresholds", "techniquevideooverrides"]);
  assert.equal(again.painThresholds.alreadyThere, 1, "relanzar no duplica");
  assert.equal(await db.raw("trainerclients").countDocuments(), 3);
});

test("reanudable: si se cortó a medias, la siguiente pasada une lo que quedaba con el par ya creado", async () => {
  const ids = await seedLegacy();
  const conn = db.mongoose.connection.db;
  // Simula una pasada cortada: el par de Ana ya existe con su primera entrada
  // y quedan los otros dos documentos viejos.
  await db.raw("trainerclients").replaceOne(
    { _id: ids.rel1 },
    { _id: ids.rel1, trainerId: ids.trainer, clientId: ids.ana, clientEmail: "ana@x.test",
      scopes: [{ _id: ids.rel1, scope: "training", status: "revoked", invitedAt: new Date(Date.UTC(2026, 0, 1)) }],
      intakePending: false, intake: null }
  );
  await migrateTrainerClientPairs(conn);
  const ana = await db.raw("trainerclients").find({ trainerId: ids.trainer, clientId: ids.ana }).toArray();
  assert.equal(ana.length, 1);
  assert.deepEqual(ana[0].scopes.map((link) => String(link._id)), [ids.rel1, ids.rel2, ids.rel3].map(String));
});
