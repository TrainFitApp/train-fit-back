const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-trainer-intake-config]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-049 (MASTER_BACKLOG.md) — confirma que:
// - sin config guardada, un trainer ve el catálogo completo (retrocompatible).
// - updateMyConfig persiste un subconjunto válido y lo devuelve tal cual.
// - updateMyConfig rechaza claves fuera del catálogo cerrado.
// - getEnabledFieldsByTrainer (usado por getOnboardingStatus) refleja la
//   config guardada, con aislamiento correcto entre trainers.
// - getOnboardingStatus adjunta intakeEnabledFields por relación pendiente.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const trainerClientService = require("../components/trainerClients/trainer-client-service");
  const trainerIntakeConfigService = require("../components/trainerIntakeConfig/trainer-intake-config-service");
  const TrainerIntakeConfig = require("../components/trainerIntakeConfig/trainer-intake-config-schema");
  const { INTAKE_FIELD_KEYS } = require("../components/trainerIntakeConfig/intake-field-catalog");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainers: [], clients: [], relations: [], configs: [] };

  try {
    const trainerA = await userSchema.create({ email: `verify-intake-cfg-a-${runId}@test.local` });
    const trainerB = await userSchema.create({ email: `verify-intake-cfg-b-${runId}@test.local` });
    created.trainers.push(trainerA, trainerB);

    // 1. Sin config guardada → catálogo completo.
    const defaultConfig = await trainerIntakeConfigService.getMyConfig(trainerA._id.toString());
    assert.deepEqual(defaultConfig.enabledFields, INTAKE_FIELD_KEYS);
    ok("sin config guardada → catálogo completo (9 campos)");

    // 2. Guardar un subconjunto válido.
    const subset = ["goals", "experienceLevel", "allergies"];
    const saved = await trainerIntakeConfigService.updateMyConfig(trainerA._id.toString(), subset);
    created.configs.push(trainerA._id);
    assert.deepEqual(saved.enabledFields, subset);
    ok("updateMyConfig con subconjunto válido → persiste tal cual");

    const reread = await trainerIntakeConfigService.getMyConfig(trainerA._id.toString());
    assert.deepEqual(reread.enabledFields, subset);
    ok("getMyConfig tras guardar → refleja lo guardado");

    // 3. Campo fuera del catálogo → rechazado.
    await assert.rejects(
      () => trainerIntakeConfigService.updateMyConfig(trainerA._id.toString(), ["goals", "campoInventado"]),
      (err) => err.code === "INVALID_INTAKE_FIELDS"
    );
    ok("campo fuera del catálogo → rechazado (INVALID_INTAKE_FIELDS)");

    // 4. Aislamiento: trainerB no tiene config guardada, no ve la de trainerA.
    const fieldsB = await trainerIntakeConfigService.getEnabledFieldsByTrainer(trainerB._id.toString());
    assert.deepEqual(fieldsB, INTAKE_FIELD_KEYS);
    ok("aislamiento: trainerB sin config propia → sigue viendo el catálogo completo");

    const fieldsA = await trainerIntakeConfigService.getEnabledFieldsByTrainer(trainerA._id.toString());
    assert.deepEqual(fieldsA, subset);
    ok("getEnabledFieldsByTrainer(trainerA) → subconjunto guardado");

    // 5. getOnboardingStatus adjunta intakeEnabledFields por relación pendiente.
    const client = await userSchema.create({ email: `verify-intake-cfg-client-${runId}@test.local` });
    created.clients.push(client);
    const pendingRel = await TrainerClient.create({
      trainerId: trainerA._id,
      clientId: client._id,
      clientEmail: client.email,
      scope: "training",
      status: "cuestionario_pendiente",
    });
    created.relations.push(pendingRel);

    const status = await trainerClientService.getOnboardingStatus(client._id.toString());
    assert.equal(status.blocked, true);
    assert.equal(status.relations.length, 1);
    assert.deepEqual(status.relations[0].intakeEnabledFields, subset);
    ok("getOnboardingStatus → relations[].intakeEnabledFields refleja la config del trainer");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
    }
    if (created.clients.length) {
      await userSchema.deleteMany({ _id: { $in: created.clients.map((c) => c._id) } });
    }
    if (created.configs.length) {
      await TrainerIntakeConfig.deleteMany({ trainerId: { $in: created.configs } });
    }
    if (created.trainers.length) {
      await userSchema.deleteMany({ _id: { $in: created.trainers.map((t) => t._id) } });
    }
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
