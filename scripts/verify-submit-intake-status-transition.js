const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-submit-intake-status-transition]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000/api";

// Reproduce el reporte: tras aceptar (cuestionario_pendiente + clientId
// puesto) y enviar el cuestionario vía POST /trainer/intake real, ¿el
// estado de TrainerClient pasa a en_revision de verdad?
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const TokenService = require("../services/token.service");

  const runId = new mongoose.Types.ObjectId().toString();
  const trainer = await userSchema.create({ email: `verify-intake-trainer-${runId}@test.local`, roles: ["trainer"] });
  const client = await userSchema.create({ email: `verify-intake-client-${runId}@test.local`, roles: ["user"] });

  // Simula el estado justo después de aceptar (respondToInvite ya probado
  // aparte) — clientId puesto, status cuestionario_pendiente.
  const relation = await trainerClientSchema.create({
    trainerId: trainer._id,
    clientId: client._id,
    clientEmail: client.email,
    scope: "training",
    status: "cuestionario_pendiente",
    respondedAt: new Date(),
  });

  const sessionId = TokenService.generateSessionId();
  await userSchema.updateOne({ _id: client._id }, { $set: { "auth.sessionId": sessionId, "auth.clientFamily": "trainfit-front" } });
  const token = TokenService.generateAccessToken(
    { sub: client._id.toString(), sid: sessionId, pver: client.passwordVersion || 0 },
    { audience: "trainfit-front" }
  );
  const headers = {
    Authorization: `Bearer ${token}`,
    "x-client-family": "trainfit-front",
    "Content-Type": "application/json",
  };

  try {
    ok("relación cuestionario_pendiente creada", relation._id.toString());

    const res = await fetch(`${BASE_URL}/trainer/intake`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        trainerId: trainer._id.toString(),
        goals: "Ganar fuerza",
        healthConditions: "",
        experienceLevel: "beginner",
        availability: "Tardes",
        equipment: "Ninguno",
        allergies: "",
        favoriteFoods: "",
        dislikedFoods: "",
        cooksAtHome: "yes",
      }),
    });
    const body = await res.json().catch(() => null);
    log("POST /trainer/intake ->", res.status, JSON.stringify(body));
    assert.equal(res.status, 201, `submitIntake debía ser 201, fue ${res.status}: ${JSON.stringify(body)}`);

    const relationAfter = await trainerClientSchema.findById(relation._id);
    log("estado en BD tras submitIntake:", relationAfter.status);
    assert.equal(relationAfter.status, "en_revision", "el estado debía pasar a en_revision tras enviar el cuestionario");
    ok("estado pasó correctamente a en_revision");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    await trainerClientSchema.deleteMany({ trainerId: trainer._id });
    const clientIntakeSchema = require("../components/clientIntake/client-intake-schema");
    await clientIntakeSchema.deleteMany({ trainerId: trainer._id });
    await userSchema.deleteOne({ _id: trainer._id });
    await userSchema.deleteOne({ _id: client._id });
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
