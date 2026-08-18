const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-check-client-email-status]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000/api";
const CLIENT_FAMILY = "trainfit-trainers";

// GET /trainer/clients/check-email — confirma que avisa por scope (training/
// nutrition por separado), que declined/revoked NO bloquea (se puede
// reinvitar), y que active/pending SÍ bloquea.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const TokenService = require("../services/token.service");

  const runId = new mongoose.Types.ObjectId().toString();
  const trainer = await userSchema.create({ email: `verify-check-email-trainer-${runId}@test.local`, roles: ["trainer"] });
  const clientEmail = `verify-check-email-client-${runId}@test.local`;

  const sessionId = TokenService.generateSessionId();
  await userSchema.updateOne({ _id: trainer._id }, { $set: { "auth.sessionId": sessionId, "auth.clientFamily": CLIENT_FAMILY } });
  const token = TokenService.generateAccessToken(
    { sub: trainer._id.toString(), sid: sessionId, pver: trainer.passwordVersion || 0 },
    { audience: CLIENT_FAMILY }
  );
  const headers = { Authorization: `Bearer ${token}`, "x-client-family": CLIENT_FAMILY };

  async function checkEmail() {
    const res = await fetch(`${BASE_URL}/trainer/clients/check-email?email=${encodeURIComponent(clientEmail)}`, { headers });
    return { status: res.status, body: await res.json() };
  }

  const relations = [];
  try {
    // --- 0) email sin ninguna relación: nada bloqueado ---
    let result = await checkEmail();
    assert.equal(result.status, 200);
    assert.equal(result.body.training.blocked, false);
    assert.equal(result.body.nutrition.blocked, false);
    ok("sin relaciones -> nada bloqueado");

    // --- 1) training en pending -> bloquea SOLO training ---
    relations.push(
      await trainerClientSchema.create({ trainerId: trainer._id, clientEmail, scope: "training", status: "pending" })
    );
    result = await checkEmail();
    assert.equal(result.body.training.blocked, true);
    assert.equal(result.body.training.status, "pending");
    assert.equal(result.body.nutrition.blocked, false);
    ok("training pending -> bloquea solo training, nutrition libre");

    // --- 2) nutrition active -> bloquea también nutrition, training sigue bloqueado ---
    relations.push(
      await trainerClientSchema.create({ trainerId: trainer._id, clientEmail, scope: "nutrition", status: "active" })
    );
    result = await checkEmail();
    assert.equal(result.body.training.blocked, true);
    assert.equal(result.body.nutrition.blocked, true);
    assert.equal(result.body.nutrition.status, "active");
    ok("nutrition active -> bloquea nutrition, training sigue bloqueado");

    // --- 3) declined/revoked no cuentan ---
    await trainerClientSchema.updateOne({ _id: relations[0]._id }, { $set: { status: "declined" } });
    await trainerClientSchema.updateOne({ _id: relations[1]._id }, { $set: { status: "revoked" } });
    result = await checkEmail();
    assert.equal(result.body.training.blocked, false);
    assert.equal(result.body.nutrition.blocked, false);
    ok("declined/revoked -> ya no bloquean, se puede reinvitar");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    await trainerClientSchema.deleteMany({ trainerId: trainer._id });
    await userSchema.deleteOne({ _id: trainer._id });
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
