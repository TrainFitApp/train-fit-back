const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-cancel-invite-onboarding]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-035 (MASTER_BACKLOG.md) — confirma que cancelInvite() ahora revoca de
// verdad las relaciones "cuestionario_pendiente"/"en_revision" (antes
// devolvía 200 sin tocar nada — éxito falso), sin romper el comportamiento
// ya correcto de "pending" (→ declined) ni el aislamiento por trainerId.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const trainerClientService = require("../components/trainerClients/trainer-client-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, otherTrainer: null, client: null, relations: [] };

  try {
    created.trainer = await userSchema.create({ email: `verify-cancel-t-${runId}@test.local` });
    created.otherTrainer = await userSchema.create({ email: `verify-cancel-t2-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-cancel-c-${runId}@test.local` });

    async function makeRelation(status) {
      const rel = await TrainerClient.create({
        trainerId: created.trainer._id,
        clientId: created.client._id,
        clientEmail: created.client.email,
        scope: "training",
        status,
      });
      created.relations.push(rel);
      return rel;
    }

    // 1. "pending" sigue funcionando como antes (declined).
    const pendingRel = await makeRelation("pending");
    const pendingResult = await trainerClientService.cancelInvite(
      created.trainer._id.toString(),
      pendingRel._id.toString()
    );
    assert.equal(pendingResult.status, "declined", "pending debe pasar a declined (comportamiento previo intacto)");
    ok("cancelInvite() en estado pending sigue funcionando (→ declined)");

    // 2. "cuestionario_pendiente" — antes era un no-op silencioso, ahora debe revocar.
    const questRel = await makeRelation("cuestionario_pendiente");
    const questResult = await trainerClientService.cancelInvite(
      created.trainer._id.toString(),
      questRel._id.toString()
    );
    assert.equal(questResult.status, "revoked", "cuestionario_pendiente debe pasar a revoked, no quedarse igual");
    ok("cancelInvite() en estado cuestionario_pendiente revoca de verdad (antes era éxito falso)");

    // 3. "en_revision" — mismo caso, sin ningún cancel/reject en la UI antes de esta tarea.
    const reviewRel = await makeRelation("en_revision");
    const reviewResult = await trainerClientService.cancelInvite(
      created.trainer._id.toString(),
      reviewRel._id.toString()
    );
    assert.equal(reviewResult.status, "revoked", "en_revision debe pasar a revoked");
    ok("cancelInvite() en estado en_revision revoca de verdad (antes no tenía ninguna vía de rechazo)");

    // 4. Estado ya terminal ("active") — debe seguir siendo no-op idempotente.
    const activeRel = await makeRelation("active");
    const activeResult = await trainerClientService.cancelInvite(
      created.trainer._id.toString(),
      activeRel._id.toString()
    );
    assert.equal(activeResult.status, "active", "un estado ya terminal no debe tocarse (idempotente)");
    ok("cancelInvite() no toca relaciones ya en un estado terminal (active)");

    // 5. Aislamiento: otro trainer no puede cancelar una relación ajena.
    const foreignRel = await makeRelation("cuestionario_pendiente");
    const foreignAttempt = await trainerClientService.cancelInvite(
      created.otherTrainer._id.toString(),
      foreignRel._id.toString()
    );
    assert.equal(foreignAttempt, null, "otro trainer no debe poder cancelar una relación que no es suya");
    const stillUnchanged = await TrainerClient.findById(foreignRel._id);
    assert.equal(stillUnchanged.status, "cuestionario_pendiente", "la relación ajena no debe haber cambiado");
    ok("cancelInvite() respeta el aislamiento por trainerId");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
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
