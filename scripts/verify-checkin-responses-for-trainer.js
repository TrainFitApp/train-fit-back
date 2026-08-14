const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-checkin-responses-for-trainer]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-002 (MASTER_BACKLOG.md) — "Reportes": confirma que
// checkinDao.listResponsesForTrainer() devuelve respuestas de VARIOS
// clientes del mismo entrenador (no solo uno), populadas con datos reales
// del cliente, ordenadas por fecha descendente, y que NO devuelve
// respuestas de otro entrenador (aislamiento correcto).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const checkinResponseSchema = require("../components/trainerCheckins/checkin-response-schema");
  const checkinDao = require("../components/trainerCheckins/checkin-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    otherTrainer: null,
    clientA: null,
    clientB: null,
    responses: [],
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-reportes-trainer-${runId}@test.local`,
    });
    created.otherTrainer = await userSchema.create({
      email: `verify-reportes-other-trainer-${runId}@test.local`,
    });
    created.clientA = await userSchema.create({
      email: `verify-reportes-clientA-${runId}@test.local`,
      name: "Ana",
      lastname: "Pérez",
    });
    created.clientB = await userSchema.create({
      email: `verify-reportes-clientB-${runId}@test.local`,
      name: "Bruno",
      lastname: "Gómez",
    });
    ok("trainer, otro trainer y 2 clientes de prueba creados");

    const respA = await checkinResponseSchema.create({
      trainerId: created.trainer._id,
      clientId: created.clientA._id,
      values: { stress_level: 3 },
    });
    const respB = await checkinResponseSchema.create({
      trainerId: created.trainer._id,
      clientId: created.clientB._id,
      values: { sleep_hours: 7 },
    });
    const respOther = await checkinResponseSchema.create({
      trainerId: created.otherTrainer._id,
      clientId: created.clientA._id,
      values: { stress_level: 5 },
    });
    created.responses.push(respA, respB, respOther);
    ok("3 respuestas de prueba creadas (2 del entrenador de prueba, 1 de otro entrenador)");

    const results = await checkinDao.listResponsesForTrainer(created.trainer._id.toString());

    assert.equal(results.length, 2, "debe devolver exactamente las 2 respuestas del entrenador de prueba");
    const ids = results.map((r) => String(r._id)).sort();
    assert.deepEqual(
      ids,
      [String(respA._id), String(respB._id)].sort(),
      "deben ser exactamente las respuestas de clientA y clientB, ninguna de otro entrenador",
    );
    ok("aislamiento correcto: solo respuestas del entrenador de prueba, ninguna de otro entrenador");

    const forClientA = results.find((r) => String(r._id) === String(respA._id));
    assert.ok(forClientA.clientId, "clientId debe venir populado");
    assert.equal(forClientA.clientId.name, "Ana", "el cliente populado debe tener el nombre real");
    assert.equal(forClientA.clientId.lastname, "Pérez", "el cliente populado debe tener el apellido real");
    ok("clientId viene populado con datos reales del cliente (name/lastname)");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.responses.length) {
      await checkinResponseSchema.deleteMany({ _id: { $in: created.responses.map((r) => r._id) } });
    }
    if (created.clientA) await userSchema.deleteOne({ _id: created.clientA._id });
    if (created.clientB) await userSchema.deleteOne({ _id: created.clientB._id });
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
