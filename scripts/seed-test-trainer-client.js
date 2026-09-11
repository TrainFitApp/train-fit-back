const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

/**
 * Cuenta de prueba mínima: un entrenador (t@t.t) con un cliente (u@u.u) ya
 * vinculado (relación activa en entrenamiento Y nutrición, sin pasar por el
 * flujo de invitación/cuestionario). Misma contraseña para los dos.
 *
 * Mismo criterio paranoico que seed-demo-coach-pro.js (corre contra `pre`,
 * Atlas compartido):
 *   - _id DETERMINISTA a partir de una semilla -> volver a correrlo no
 *     duplica nada, reescribe los mismos documentos.
 *   - create() (no updateOne/insertMany) para que el pre('save') del
 *     esquema cifre la contraseña.
 *   - `--clean` borra EXACTAMENTE estos 2 usuarios + sus 2 TrainerClient.
 *
 * USO
 *   node scripts/seed-test-trainer-client.js          -> siembra
 *   node scripts/seed-test-trainer-client.js --clean   -> borra
 */

const PASSWORD = "Abcd123$";
const TRAINER_EMAIL = "t@t.t";
const CLIENT_EMAIL = "u@u.u";

function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-test-account:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const TRAINER_ID = oid("trainer:t@t.t");
const CLIENT_ID = oid("client:u@u.u");
const REL_TRAINING_ID = oid("rel:training");
const REL_NUTRITION_ID = oid("rel:nutrition");

const clean = process.argv.includes("--clean");

async function main() {
  const uri = buildMongoUri();
  console.log("[test-account]", clean ? "CLEAN" : "SEED", redactMongoUri(uri));
  await mongoose.connect(uri);

  const User = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");

  if (clean) {
    await TrainerClient.deleteMany({ _id: { $in: [REL_TRAINING_ID, REL_NUTRITION_ID] } });
    await User.deleteMany({ _id: { $in: [TRAINER_ID, CLIENT_ID] } });
    console.log("[test-account] borrados t@t.t, u@u.u y su relación");
    await mongoose.disconnect();
    return;
  }

  await User.deleteOne({ _id: TRAINER_ID });
  const trainer = await User.create({
    _id: TRAINER_ID,
    name: "Test",
    lastname: "Trainer",
    email: TRAINER_EMAIL,
    password: PASSWORD, // hook pre('save') lo cifra
    status: "active",
    roles: ["trainer"],
    theme: "dark",
    lang: "es",
  });
  console.log("[test-account] trainer", TRAINER_EMAIL, "->", trainer._id.toString());

  await User.deleteOne({ _id: CLIENT_ID });
  const client = await User.create({
    _id: CLIENT_ID,
    name: "Test",
    lastname: "User",
    email: CLIENT_EMAIL,
    password: PASSWORD,
    status: "active",
    roles: ["user"],
    sex: 1,
    height: 175,
    weight: 75,
    birth: new Date("1995-01-01"),
    activity: 1.45,
    steps: 1, // STEPS_NOT_COUNTED -> usa el factor de actividad
    training: 1.5,
    objetive: -300,
    theme: "dark",
    lang: "es",
  });
  console.log("[test-account] cliente", CLIENT_EMAIL, "->", client._id.toString());

  for (const [relId, scope] of [[REL_TRAINING_ID, "training"], [REL_NUTRITION_ID, "nutrition"]]) {
    await TrainerClient.updateOne(
      { _id: relId },
      {
        $set: {
          trainerId: TRAINER_ID,
          clientId: CLIENT_ID,
          clientEmail: CLIENT_EMAIL,
          scope,
          status: "active",
          respondedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
  console.log("[test-account] vinculados (training + nutrition, status active)");

  await mongoose.disconnect();
  console.log(`\n[test-account] listo:\n  entrenador  ${TRAINER_EMAIL} / ${PASSWORD}\n  cliente     ${CLIENT_EMAIL} / ${PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
