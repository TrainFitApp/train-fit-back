const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-checkin-unseen-count]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-024 (MASTER_BACKLOG.md) — confirma que countUnseenForTrainer cuenta
// solo las respuestas propias con seenByTrainer=false, que markAllSeenForTrainer
// las limpia todas de golpe, y que ambas respetan el aislamiento por trainerId.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const checkinDao = require("../components/trainerCheckins/checkin-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, otherTrainer: null, client: null, responses: [] };

  try {
    created.trainer = await userSchema.create({ email: `verify-unseen-t-${runId}@test.local` });
    created.otherTrainer = await userSchema.create({ email: `verify-unseen-t2-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-unseen-c-${runId}@test.local` });

    for (let i = 0; i < 3; i++) {
      const resp = await checkinDao.createResponse(created.trainer._id, created.client._id, { mood: 7 });
      created.responses.push(resp);
    }
    // Una respuesta de otro trainer — no debe contar ni marcarse.
    const foreignResp = await checkinDao.createResponse(created.otherTrainer._id, created.client._id, { mood: 5 });
    created.responses.push(foreignResp);

    // 1. Recién creadas, las 3 propias cuentan como no vistas.
    const initialCount = await checkinDao.countUnseenForTrainer(created.trainer._id.toString());
    assert.equal(initialCount, 3, "las 3 respuestas recién creadas deben contar como no vistas");
    ok("countUnseenForTrainer() cuenta correctamente las respuestas nuevas");

    // 2. markAllSeenForTrainer limpia el contador a 0.
    await checkinDao.markAllSeenForTrainer(created.trainer._id.toString());
    const afterMarkCount = await checkinDao.countUnseenForTrainer(created.trainer._id.toString());
    assert.equal(afterMarkCount, 0, "tras marcar como vistas, el contador debe quedar en 0");
    ok("markAllSeenForTrainer() limpia el contador correctamente");

    // 3. No debe haber tocado la respuesta del otro trainer.
    const otherTrainerCount = await checkinDao.countUnseenForTrainer(created.otherTrainer._id.toString());
    assert.equal(otherTrainerCount, 1, "la respuesta del otro trainer debe seguir sin marcar (aislamiento)");
    ok("markAllSeenForTrainer() respeta el aislamiento por trainerId — no toca respuestas ajenas");

    // 4. Una respuesta nueva tras marcar vuelve a contar.
    await checkinDao.createResponse(created.trainer._id, created.client._id, { mood: 8 });
    const afterNewResponse = await checkinDao.countUnseenForTrainer(created.trainer._id.toString());
    assert.equal(afterNewResponse, 1, "una respuesta nueva tras marcar como vistas debe volver a contar");
    ok("una respuesta nueva tras marcar-vistas vuelve a incrementar el contador");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    const allResponses = await CheckinResponse.find({
      clientId: created.client ? created.client._id : null,
    }).select("_id");
    if (allResponses.length) {
      await CheckinResponse.deleteMany({ _id: { $in: allResponses.map((r) => r._id) } });
    }
    if (created.client) await userSchema.deleteOne({ _id: created.client._id });
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
    if (created.otherTrainer) await userSchema.deleteOne({ _id: created.otherTrainer._id });
    ok("datos de prueba borrados");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
