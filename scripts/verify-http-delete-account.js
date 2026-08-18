const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-http-delete-account]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000/api";
const CLIENT_FAMILY = "trainfit-trainers";

// Prueba el borrado de cuenta REAL vía DELETE /api/users/:id (no la cascada
// interna llamada a mano) — el trainer se borra a sí mismo, exactamente como
// lo haría la app. Confirma que la cascada completa de hoy (16 colecciones)
// corre de verdad detrás del endpoint HTTP real, no solo cuando se invoca el
// dao directo.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const mealSchema = require("../components/meals/meal-schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const TokenService = require("../services/token.service");

  const runId = new mongoose.Types.ObjectId().toString();
  const trainer = await userSchema.create({
    email: `verify-http-delete-${runId}@test.local`,
    roles: ["trainer", "user"],
  });
  const client = await userSchema.create({
    email: `verify-http-delete-client-${runId}@test.local`,
    roles: ["user"],
  });

  const relation = await trainerClientSchema.create({
    trainerId: trainer._id,
    clientId: client._id,
    clientEmail: client.email,
    scope: "training",
    status: "active",
  });

  const template = await workoutSchema.create({ trainerId: trainer._id, name: "Plantilla a borrar" });
  const snippet = await mealSchema.create({ trainerId: trainer._id, name: "Snippet a borrar" });
  const dietTpl = await dietTemplateSchema.create({ trainerId: trainer._id, name: "Dieta a borrar", days: [] });
  ok("trainer con contenido en 4 colecciones (relación, workout template, meal snippet, diet template) listo");

  const sessionId = TokenService.generateSessionId();
  await userSchema.updateOne(
    { _id: trainer._id },
    { $set: { "auth.sessionId": sessionId, "auth.clientFamily": CLIENT_FAMILY } }
  );
  const token = TokenService.generateAccessToken(
    { sub: trainer._id.toString(), sid: sessionId, pver: trainer.passwordVersion || 0 },
    { audience: CLIENT_FAMILY }
  );
  const headers = { Authorization: `Bearer ${token}`, "x-client-family": CLIENT_FAMILY };

  try {
    const res = await fetch(`${BASE_URL}/users/${trainer._id}`, { method: "DELETE", headers });
    assert.equal(res.status, 204, `DELETE /users/:id debía ser 204, fue ${res.status}`);
    ok("DELETE /api/users/:id -> 204");

    const trainerAfter = await userSchema.findById(trainer._id);
    assert.equal(trainerAfter, null, "el trainer debe estar borrado");

    const relationAfter = await trainerClientSchema.findById(relation._id);
    const templateAfter = await workoutSchema.findOne({ _id: template._id });
    const snippetAfter = await mealSchema.findOne({ _id: snippet._id });
    const dietTplAfter = await dietTemplateSchema.findById(dietTpl._id);

    assert.equal(relationAfter, null, "TrainerClient debe borrarse en cascada por el endpoint HTTP real");
    assert.equal(templateAfter, null, "WorkoutTemplate debe borrarse en cascada por el endpoint HTTP real");
    assert.equal(snippetAfter, null, "MealSnippet debe borrarse en cascada por el endpoint HTTP real");
    assert.equal(dietTplAfter, null, "DietTemplate debe borrarse en cascada por el endpoint HTTP real");
    ok("las 4 colecciones quedaron limpias tras DELETE /api/users/:id real");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    await userSchema.deleteOne({ _id: client._id }).catch(() => {});
    ok("cliente borrado");
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
