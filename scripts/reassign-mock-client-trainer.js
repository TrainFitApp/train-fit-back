const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[reassign-mock-client-trainer]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Reasigna el cliente de relleno (seed-mock-training-comparison.js) del
// trainer throwaway a una cuenta de trainer real, para que aparezca en su
// propia sesión de navegador en vez de tener que loguearse con otra cuenta.

const CLIENT_EMAIL = "mock-client@test.local";
const OLD_TRAINER_EMAIL = "mock-trainer@test.local";
const NEW_TRAINER_EMAIL = process.argv[2];

async function main() {
  if (!NEW_TRAINER_EMAIL) {
    console.error(LOG_PREFIX, "uso: node scripts/reassign-mock-client-trainer.js <email-del-trainer-real>");
    process.exit(1);
  }

  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const tableSchema = require("../components/tables/table-schema");

  const client = await userSchema.findOne({ email: CLIENT_EMAIL });
  if (!client) {
    console.error(LOG_PREFIX, `no existe el cliente ${CLIENT_EMAIL} — ejecuta antes seed-mock-training-comparison.js`);
    process.exit(1);
  }

  const newTrainer = await userSchema.findOne({ email: NEW_TRAINER_EMAIL });
  if (!newTrainer) {
    console.error(LOG_PREFIX, `no existe ninguna cuenta con el email ${NEW_TRAINER_EMAIL}`);
    process.exit(1);
  }
  if (!(newTrainer.roles || []).includes("trainer")) {
    console.error(LOG_PREFIX, `${NEW_TRAINER_EMAIL} existe pero no tiene el rol "trainer" (roles: ${(newTrainer.roles || []).join(", ") || "ninguno"})`);
    process.exit(1);
  }

  await TrainerClient.deleteMany({ clientEmail: CLIENT_EMAIL });
  await TrainerClient.create({
    trainerId: newTrainer._id,
    clientId: client._id,
    clientEmail: client.email,
    scope: "training",
    status: "active",
  });
  ok(`relación creada: ${NEW_TRAINER_EMAIL} -> ${CLIENT_EMAIL}`);

  const tableUpdate = await tableSchema.updateMany(
    { userId: client._id },
    { $set: { assignedByTrainerId: newTrainer._id } }
  );
  ok(`${tableUpdate.modifiedCount} rutina(s) reasignada(s) como "asignada por" ${NEW_TRAINER_EMAIL}`);

  const oldTrainer = await userSchema.findOne({ email: OLD_TRAINER_EMAIL });
  if (oldTrainer) {
    await userSchema.deleteOne({ _id: oldTrainer._id });
    ok(`cuenta throwaway ${OLD_TRAINER_EMAIL} eliminada`);
  }

  console.log("");
  console.log(LOG_PREFIX, `Ya puedes ver "Cliente Mock" en tu propia sesión (${NEW_TRAINER_EMAIL}), pestaña Clientes.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(LOG_PREFIX, "ERROR", err);
  process.exit(1);
});
