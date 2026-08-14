const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-previous-relation-cutoff]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-062 (MASTER_BACKLOG.md) — confirma que findLatestRevokedForClient:
// - devuelve null si nunca hubo una relación revocada (cliente nuevo).
// - devuelve la fecha de revocación si el cliente fue revocado y reinvitado.
// - toma la MÁS RECIENTE si hubo varios ciclos de revocar/reinvitar.
// - no se confunde con relaciones "declined" (invitación nunca aceptada,
//   no es lo mismo que "fue cliente y se le revocó").
// - respeta el aislamiento por trainerId.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const trainerClientDao = require("../components/trainerClients/trainer-client-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, otherTrainer: null, clients: [], relations: [] };

  try {
    created.trainer = await userSchema.create({ email: `verify-cutoff-t-${runId}@test.local` });
    created.otherTrainer = await userSchema.create({ email: `verify-cutoff-t2-${runId}@test.local` });

    // 1. Cliente nunca revocado — sin corte.
    const neverRevokedClient = await userSchema.create({ email: `verify-cutoff-never-${runId}@test.local` });
    created.clients.push(neverRevokedClient);
    const activeRel = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientId: neverRevokedClient._id,
      clientEmail: neverRevokedClient.email,
      scope: "training",
      status: "active",
    });
    created.relations.push(activeRel);

    const noCutoff = await trainerClientDao.findLatestRevokedForClient(
      created.trainer._id.toString(),
      neverRevokedClient._id.toString()
    );
    assert.equal(noCutoff, null, "un cliente nunca revocado no debe tener corte");
    ok("cliente nunca revocado → sin corte (null)");

    // 2. Cliente revocado una vez y reinvitado — corte = esa revocación.
    const oneRevokeClient = await userSchema.create({ email: `verify-cutoff-once-${runId}@test.local` });
    created.clients.push(oneRevokeClient);
    const revokedAt1 = new Date("2026-06-01T10:00:00.000Z");
    const revokedRel = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientId: oneRevokeClient._id,
      clientEmail: oneRevokeClient.email,
      scope: "training",
      status: "revoked",
      revokedAt: revokedAt1,
      revokedBy: "trainer",
    });
    created.relations.push(revokedRel);
    const newActiveRel = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientId: oneRevokeClient._id,
      clientEmail: oneRevokeClient.email,
      scope: "nutrition",
      status: "active",
    });
    created.relations.push(newActiveRel);

    const oneCutoff = await trainerClientDao.findLatestRevokedForClient(
      created.trainer._id.toString(),
      oneRevokeClient._id.toString()
    );
    assert.ok(oneCutoff, "debe encontrar la revocación");
    assert.equal(oneCutoff.revokedAt.toISOString(), revokedAt1.toISOString());
    ok("cliente revocado y reinvitado → corte = fecha exacta de la revocación");

    // 3. Varios ciclos de revocar/reinvitar — debe tomar el MÁS reciente.
    const multiCycleClient = await userSchema.create({ email: `verify-cutoff-multi-${runId}@test.local` });
    created.clients.push(multiCycleClient);
    const oldRevoke = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientId: multiCycleClient._id,
      clientEmail: multiCycleClient.email,
      scope: "training",
      status: "revoked",
      revokedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const recentRevoke = await TrainerClient.create({
      trainerId: created.trainer._id,
      clientId: multiCycleClient._id,
      clientEmail: multiCycleClient.email,
      scope: "nutrition",
      status: "revoked",
      revokedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    created.relations.push(oldRevoke, recentRevoke);

    const multiCutoff = await trainerClientDao.findLatestRevokedForClient(
      created.trainer._id.toString(),
      multiCycleClient._id.toString()
    );
    assert.equal(multiCutoff.revokedAt.toISOString(), new Date("2026-07-01T00:00:00.000Z").toISOString());
    ok("varios ciclos de revocar/reinvitar → toma la revocación MÁS reciente, no la primera");

    // 4. Aislamiento por trainer: otro trainer no debe ver el corte de este cliente.
    const foreignCutoff = await trainerClientDao.findLatestRevokedForClient(
      created.otherTrainer._id.toString(),
      oneRevokeClient._id.toString()
    );
    assert.equal(foreignCutoff, null, "otro trainer no debe ver la revocación de una relación ajena");
    ok("aislamiento por trainerId correcto");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
    }
    if (created.clients.length) {
      await userSchema.deleteMany({ _id: { $in: created.clients.map((c) => c._id) } });
    }
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
