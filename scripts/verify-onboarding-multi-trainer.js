const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-onboarding-multi-trainer]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Reproduce el caso descrito por el usuario: un cliente con 2 relaciones
// pendientes de INTAKE con 2 trainers DISTINTOS (uno de nutrición, otro de
// entrenamiento). Confirma que:
// - tras aceptar ambas invitaciones, getOnboardingStatus las lista las 2.
// - tras rellenar el intake del trainer A, el B sigue apareciendo pendiente
//   de rellenar (no desaparece, no se pierde, sigue bloqueado hasta que
//   TAMBIÉN se rellene ese).
// - tras rellenar el B también, ambos quedan en_revision (nada más que
//   rellenar), sigue bloqueado hasta que un trainer confirme.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const ClientIntake = require("../components/clientIntake/client-intake-schema");
  const trainerClientService = require("../components/trainerClients/trainer-client-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { users: [], relations: [], intakes: [] };

  try {
    const trainerA = await userSchema.create({ email: `verify-multi-a-${runId}@test.local`, roles: ["trainer"] });
    const trainerB = await userSchema.create({ email: `verify-multi-b-${runId}@test.local`, roles: ["trainer"] });
    const client = await userSchema.create({ email: `verify-multi-client-${runId}@test.local`, roles: ["user"] });
    created.users.push(trainerA, trainerB, client);

    // Simula 2 invitaciones ya aceptadas (cuestionario_pendiente), una por trainer.
    const relA = await TrainerClient.create({
      trainerId: trainerA._id,
      clientId: client._id,
      clientEmail: client.email,
      scope: "nutrition",
      status: "cuestionario_pendiente",
    });
    const relB = await TrainerClient.create({
      trainerId: trainerB._id,
      clientId: client._id,
      clientEmail: client.email,
      scope: "training",
      status: "cuestionario_pendiente",
    });
    created.relations.push(relA, relB);

    let status = await trainerClientService.getOnboardingStatus(client._id.toString());
    assert.equal(status.blocked, true);
    assert.equal(status.relations.length, 2, "las 2 relaciones pendientes deben listarse");
    ok("getOnboardingStatus lista las 2 relaciones pendientes (2 trainers distintos)");

    // Rellena el intake del trainer A únicamente.
    const intakeA = await trainerClientService.submitIntake(trainerA._id.toString(), client._id.toString(), {
      goals: "Perder grasa",
    });
    created.intakes.push(intakeA._id);

    status = await trainerClientService.getOnboardingStatus(client._id.toString());
    assert.equal(status.blocked, true, "sigue bloqueado — trainer B aún sin rellenar ni confirmar");
    assert.equal(status.relations.length, 2, "trainer B NO debe desaparecer de la lista");
    const relBAfter = status.relations.find((r) => String(r.trainerId) === String(trainerB._id));
    assert.ok(relBAfter, "la relación con trainer B sigue presente");
    assert.equal(relBAfter.status, "cuestionario_pendiente", "trainer B sigue pendiente de rellenar");
    const relAAfter = status.relations.find((r) => String(r.trainerId) === String(trainerA._id));
    assert.equal(relAAfter.status, "en_revision", "trainer A pasa a en_revision tras rellenar");
    ok("tras rellenar A, B sigue apareciendo como pendiente de rellenar (no se pierde)");

    // Rellena el intake del trainer B también — el cliente NO debe quedar
    // bloqueado sin poder hacerlo por haber rellenado ya el de A.
    const intakeB = await trainerClientService.submitIntake(trainerB._id.toString(), client._id.toString(), {
      goals: "Ganar fuerza",
    });
    created.intakes.push(intakeB._id);

    status = await trainerClientService.getOnboardingStatus(client._id.toString());
    assert.equal(status.blocked, true, "sigue bloqueado — ningún trainer ha confirmado todavía");
    assert.ok(
      status.relations.every((r) => r.status === "en_revision"),
      "ambas relaciones en en_revision tras rellenar las 2"
    );
    ok("el cliente SÍ pudo rellenar el intake del trainer B tras el de A — no se quedó atascado");

    // Precarga: si ese mismo trainer A añade MÁS TARDE un segundo scope
    // (nueva relación cuestionario_pendiente), reabrir el formulario debe
    // poder recuperar lo que el cliente ya había respondido, vía
    // clientIntakeDao.getByTrainerAndClient (lo que expone GET /trainer/intake/:trainerId).
    const clientIntakeDao = require("../components/clientIntake/client-intake-dao");
    const storedForA = await clientIntakeDao.getByTrainerAndClient(trainerA._id.toString(), client._id.toString());
    assert.equal(storedForA.goals, "Perder grasa", "lo respondido antes para A sigue recuperable para precargar");
    const storedForNoOne = await clientIntakeDao.getByTrainerAndClient(
      new mongoose.Types.ObjectId().toString(),
      client._id.toString()
    );
    assert.equal(storedForNoOne, null, "trainer sin intake previo → null (formulario en blanco, comportamiento actual)");
    ok("clientIntakeDao.getByTrainerAndClient recupera lo ya respondido para precargar el formulario");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.intakes.length) {
      await ClientIntake.deleteMany({ _id: { $in: created.intakes } });
    }
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
    }
    if (created.users.length) {
      await userSchema.deleteMany({ _id: { $in: created.users.map((u) => u._id) } });
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
