const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-intake-custom-questions]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Confirma que:
// - updateMyConfig persiste customQuestions (label + enabled, sin ámbito —
//   de libre selección igual que los 9 campos predefinidos) y los devuelve con un id.
// - una pregunta nueva sin enabled explícito se guarda enabled:true.
// - label vacío/demasiado largo → rechazado.
// - getOnboardingStatus adjunta intakeCustomQuestions (id + label) por relación, trainer-level,
//   SOLO las enabled:true (una desactivada no llega al cliente pero no se borra).
// - submitIntake guarda customAnswers y getClientIntake los devuelve tal cual.
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
  const ClientIntake = require("../components/clientIntake/client-intake-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainers: [], clients: [], relations: [], configs: [], intakes: [] };

  try {
    const trainer = await userSchema.create({ email: `verify-custom-q-${runId}@test.local` });
    created.trainers.push(trainer);
    const trainerId = trainer._id.toString();

    // 1. Guardar 2 preguntas custom válidas — la segunda ya desactivada —
    //    junto con los checkboxes de ámbito marcados en ese momento.
    const saved = await trainerIntakeConfigService.updateMyConfig(
      trainerId,
      ["goals"],
      [
        { label: "¿Alguna cirugía reciente?" },
        { label: "¿Comidas fuera de casa entre semana?", enabled: false },
      ],
      ["training", "nutrition"]
    );
    created.configs.push(trainer._id);
    assert.equal(saved.customQuestions.length, 2);
    assert.ok(saved.customQuestions[0].id, "cada pregunta debe volver con un id");
    assert.equal(saved.customQuestions[0].label, "¿Alguna cirugía reciente?");
    assert.equal(saved.customQuestions[0].enabled, true, "sin enabled explícito → true por defecto");
    assert.equal(saved.customQuestions[1].enabled, false, "enabled:false se respeta");
    assert.deepEqual(saved.lastScopes, ["training", "nutrition"]);
    ok("updateMyConfig persiste customQuestions (label + enabled) y lastScopes");

    const rereadForScopes = await trainerIntakeConfigService.getMyConfig(trainerId);
    assert.deepEqual(rereadForScopes.lastScopes, ["training", "nutrition"]);
    ok("getMyConfig → lastScopes se recuerda entre cargas");

    await assert.rejects(
      () => trainerIntakeConfigService.updateMyConfig(trainerId, ["goals"], [], ["otro"]),
      (err) => err.code === "INVALID_LAST_SCOPES"
    );
    ok("lastScopes fuera de ['training','nutrition'] → rechazado");

    const questionId = saved.customQuestions[0].id;

    // 2. label vacío → rechazado.
    await assert.rejects(
      () => trainerIntakeConfigService.updateMyConfig(trainerId, ["goals"], [{ label: "   " }]),
      (err) => err.code === "INVALID_CUSTOM_QUESTIONS"
    );
    ok("label vacío → rechazado (INVALID_CUSTOM_QUESTIONS)");

    // Restaurar las 2 preguntas válidas (el intento #2/#3 fallido no debe haber persistido nada).
    const rereadConfig = await trainerIntakeConfigService.getMyConfig(trainerId);
    assert.equal(rereadConfig.customQuestions.length, 2);
    ok("un guardado rechazado no deja el estado a medias");

    // 4. getOnboardingStatus adjunta intakeCustomQuestions por relación.
    const client = await userSchema.create({ email: `verify-custom-q-client-${runId}@test.local` });
    created.clients.push(client);
    const pendingRel = await TrainerClient.create({
      trainerId: trainer._id,
      clientId: client._id,
      clientEmail: client.email,
      scope: "training",
      status: "cuestionario_pendiente",
    });
    created.relations.push(pendingRel);

    const status = await trainerClientService.getOnboardingStatus(client._id.toString());
    assert.equal(status.relations.length, 1);
    assert.equal(status.relations[0].intakeCustomQuestions.length, 1, "la desactivada no llega al cliente");
    assert.equal(status.relations[0].intakeCustomQuestions[0].label, "¿Alguna cirugía reciente?");
    ok("getOnboardingStatus → relations[].intakeCustomQuestions solo trae las enabled:true");

    // 5. submitIntake guarda customAnswers, getClientIntake los devuelve.
    const intake = await trainerClientService.submitIntake(trainerId, client._id.toString(), {
      goals: "Ganar fuerza",
      customAnswers: [
        { questionId, label: "¿Alguna cirugía reciente?", value: "No" },
        { questionId: "id-inventado", label: "<script>", value: "x".repeat(2000) },
      ],
    });
    created.intakes.push(intake._id);
    assert.equal(intake.customAnswers.length, 2, "ambas respuestas se guardan (el backend no valida el questionId contra la config)");
    assert.equal(intake.customAnswers[0].value, "No");
    assert.equal(intake.customAnswers[1].value.length, 1000, "value se recorta a 1000 caracteres");
    ok("submitIntake persiste customAnswers, sanitizadas");

    const reread = await ClientIntake.findOne({ trainerId, clientId: client._id }).lean();
    assert.equal(reread.customAnswers.length, 2);
    ok("getClientIntake (lectura directa) devuelve customAnswers");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.intakes.length) {
      await ClientIntake.deleteMany({ _id: { $in: created.intakes } });
    }
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
