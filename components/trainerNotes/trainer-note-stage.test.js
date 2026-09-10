const test = require("node:test");
const assert = require("node:assert/strict");

test("legacy pin endpoint cannot mutate notes from a completed stage after return", { skip: process.env.TRAINFIT_OVERVIEW_INTEGRATION !== "1", timeout: 30000 }, async (t) => {
  const mongoose = require("mongoose");
  const database = `trainfit_note_stage_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 4000 });
  t.after(async () => {
    if (mongoose.connection.host === "127.0.0.1" && mongoose.connection.name === database && /^trainfit_note_stage_test_\d+_\d+$/.test(database)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const Relation = require("../trainerClients/trainer-client-schema");
  const Note = require("./trainer-note-schema");
  const noteDao = require("./trainer-note-dao");
  const { CoachingStage } = require("../clientOverview/overview-schema");
  const { ensureStages } = require("../clientOverview/stage-service");
  await Promise.all([Relation.init(), Note.init(), CoachingStage.init()]);
  const trainerId = new mongoose.Types.ObjectId();
  const clientId = new mongoose.Types.ObjectId();
  await Relation.create([
    { trainerId, clientId, clientEmail: "client@note-stage.invalid", scope: "training", status: "revoked", respondedAt: new Date("2026-01-01"), revokedAt: new Date("2026-02-01") },
    { trainerId, clientId, clientEmail: "client@note-stage.invalid", scope: "training", status: "active", respondedAt: new Date("2026-09-01") },
  ]);
  const { stages } = await ensureStages(trainerId, clientId);
  assert.equal(stages.length, 2);
  const historical = await Note.create({ trainerId, clientId, stageId: stages[0]._id, text: "Lesión antigua", pinned: false, createdAt: new Date("2026-01-10") });
  const legacyHistorical = await Note.create({ trainerId, clientId, text: "Referencia antigua sin etapa", pinned: false, createdAt: new Date("2026-01-11") });
  const current = await Note.create({ trainerId, clientId, stageId: stages[1]._id, text: "Horario actual", pinned: false, createdAt: new Date("2026-09-05") });

  assert.equal(await noteDao.setPinned(trainerId, clientId, historical._id, true), null);
  assert.equal(await noteDao.setPinned(trainerId, clientId, legacyHistorical._id, true), null);
  assert.equal((await Note.findById(historical._id).lean()).pinned, false);
  assert.equal((await Note.findById(legacyHistorical._id).lean()).pinned, false);
  const updated = await noteDao.setPinned(trainerId, clientId, current._id, true);
  assert.equal(updated.pinned, true);
  assert.equal(updated.version, 1);
  await assert.rejects(noteDao.setPinned(new mongoose.Types.ObjectId(), clientId, current._id, false), (error) => error.status === 403);
});
