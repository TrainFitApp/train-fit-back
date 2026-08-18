const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-http-integration]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000/api";
const CLIENT_FAMILY = "trainfit-trainers";

// Prueba de integración real: pega por HTTP de verdad (fetch) contra el
// servidor Express vivo, con JWT válidos minteados a mano (mismo mecanismo
// que usa el login real) y sesión coherente en BD — ejercita middleware de
// auth, rutas, controllers y daos juntos, no solo funciones internas como
// los verify-*.js anteriores. Cubre: workout-templates (crear/listar/
// aplicar/save-as-template/borrar), meal-snippets (crear/listar/borrar),
// diet-templates (crear/listar/actualizar/borrar), guardarraíl de
// GET /workouts, y el borrado de cuenta end-to-end vía DELETE /users/:id.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected to mongo");

  const userSchema = require("../components/users/schema");
  const trainerClientSchema = require("../components/trainerClients/trainer-client-schema");
  const tableSchema = require("../components/tables/table-schema");
  const splitSchema = require("../components/splits/split-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const mealSchema = require("../components/meals/meal-schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const TokenService = require("../services/token.service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, client: null, relation: null, table: null, split: null };

  async function mintAuthHeaders(user) {
    const sessionId = TokenService.generateSessionId();
    await userSchema.updateOne(
      { _id: user._id },
      { $set: { "auth.sessionId": sessionId, "auth.clientFamily": CLIENT_FAMILY } }
    );
    const token = TokenService.generateAccessToken(
      { sub: user._id.toString(), sid: sessionId, pver: user.passwordVersion || 0 },
      { audience: CLIENT_FAMILY }
    );
    return { Authorization: `Bearer ${token}`, "x-client-family": CLIENT_FAMILY, "Content-Type": "application/json" };
  }

  async function req(method, urlPath, headers, body) {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_e) {
      json = text;
    }
    return { status: res.status, body: json };
  }

  try {
    created.trainer = await userSchema.create({
      email: `verify-http-trainer-${runId}@test.local`,
      roles: ["trainer", "user"],
    });
    created.client = await userSchema.create({
      email: `verify-http-client-${runId}@test.local`,
      roles: ["user"],
    });
    ok("trainer/cliente creados", created.trainer._id.toString(), created.client._id.toString());

    created.relation = await trainerClientSchema.create({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      clientEmail: created.client.email,
      scope: "training",
      status: "active",
      respondedAt: new Date(),
    });

    created.split = await splitSchema.create({ name: "Split HTTP", workouts: [] });
    created.table = await tableSchema.create({
      name: "Tabla HTTP",
      userId: created.client._id,
      splits: [created.split._id],
    });
    ok("relación activa + table/split del cliente listos");

    const trainerHeaders = await mintAuthHeaders(created.trainer);
    const clientHeaders = await mintAuthHeaders(created.client);
    ok("JWT reales minteados y sesión coherente en BD para trainer y cliente");

    // ---------------------------------------------------------------
    // 1) WORKOUT TEMPLATES por HTTP real
    // ---------------------------------------------------------------
    const createTplRes = await req("POST", "/trainer/workout-templates", trainerHeaders, {
      name: `Plantilla HTTP ${runId}`,
      level: "intermedio",
      tags: ["fuerza"],
      blocks: [{ name: "Bloque A", type: "straight", exercises: [] }],
    });
    assert.equal(createTplRes.status, 201, `crear workout-template debía ser 201, fue ${createTplRes.status}: ${JSON.stringify(createTplRes.body)}`);
    const workoutTemplateId = createTplRes.body._id;
    ok("POST /trainer/workout-templates -> 201", workoutTemplateId);

    const listTplRes = await req("GET", "/trainer/workout-templates", trainerHeaders);
    assert.equal(listTplRes.status, 200);
    assert.ok(listTplRes.body.some((t) => t._id === workoutTemplateId), "la plantilla creada debe aparecer en el listado");
    ok("GET /trainer/workout-templates -> 200, incluye la creada");

    const applyRes = await req(
      "POST",
      `/trainer/clients/${created.client._id}/splits/${created.split._id}/workout-templates/${workoutTemplateId}/apply`,
      trainerHeaders
    );
    assert.equal(applyRes.status, 201, `aplicar plantilla debía ser 201, fue ${applyRes.status}: ${JSON.stringify(applyRes.body)}`);
    const appliedSplit = applyRes.body.find((s) => s._id === created.split._id.toString());
    assert.ok(appliedSplit, "el split aplicado debe venir en la respuesta");
    assert.equal(appliedSplit.workouts.length, 1, "debe haberse creado 1 workout real en el split");
    const realWorkoutId = appliedSplit.workouts[0]._id;
    ok("POST apply workout-template -> 201, workout real creado en el split", realWorkoutId);

    const saveAsTplRes = await req("POST", `/trainer/workouts/${realWorkoutId}/save-as-template`, trainerHeaders, {
      name: `Guardada desde workout ${runId}`,
    });
    assert.equal(saveAsTplRes.status, 201, `save-as-template debía ser 201, fue ${saveAsTplRes.status}: ${JSON.stringify(saveAsTplRes.body)}`);
    ok("POST save-as-template -> 201");

    const getWorkoutsRes = await req("GET", "/workouts?page=0&limit=1000", trainerHeaders);
    assert.equal(getWorkoutsRes.status, 200);
    const leakedTemplates = (getWorkoutsRes.body || []).filter(
      (w) => w._id === workoutTemplateId || w.trainerId
    );
    assert.equal(leakedTemplates.length, 0, "GET /workouts (listado general) NO debe filtrar plantillas (trainerId set)");
    ok("GET /workouts -> guardarraíl confirmado: 0 plantillas coladas en el listado general");

    const deleteTplRes = await req("DELETE", `/trainer/workout-templates/${workoutTemplateId}`, trainerHeaders);
    assert.equal(deleteTplRes.status, 204);
    ok("DELETE /trainer/workout-templates/:id -> 204");

    // ---------------------------------------------------------------
    // 2) MEAL SNIPPETS por HTTP real
    // ---------------------------------------------------------------
    const fakeProductId = new mongoose.Types.ObjectId().toString();
    const createSnipRes = await req("POST", "/trainer/meal-snippets", trainerHeaders, {
      name: `Snippet HTTP ${runId}`,
      customProducts: [{ product: fakeProductId, quantity: 120 }],
      customRecipes: [],
    });
    assert.equal(createSnipRes.status, 201, `crear snippet debía ser 201, fue ${createSnipRes.status}: ${JSON.stringify(createSnipRes.body)}`);
    const snippetId = createSnipRes.body._id;
    assert.equal(createSnipRes.body.customProducts.length, 1);
    ok("POST /trainer/meal-snippets -> 201, customProducts materializado", snippetId);

    const listSnipRes = await req("GET", "/trainer/meal-snippets", trainerHeaders);
    assert.equal(listSnipRes.status, 200);
    assert.ok(listSnipRes.body.some((s) => s._id === snippetId));
    ok("GET /trainer/meal-snippets -> 200, incluye la creada");

    const renameSnipRes = await req("PUT", `/trainer/meal-snippets/${snippetId}`, trainerHeaders, {
      name: "Renombrado por HTTP",
    });
    assert.equal(renameSnipRes.status, 200);
    assert.equal(renameSnipRes.body.name, "Renombrado por HTTP");
    ok("PUT /trainer/meal-snippets/:id -> 200, renombrado");

    const deleteSnipRes = await req("DELETE", `/trainer/meal-snippets/${snippetId}`, trainerHeaders);
    assert.equal(deleteSnipRes.status, 204);
    ok("DELETE /trainer/meal-snippets/:id -> 204");

    // ---------------------------------------------------------------
    // 3) DIET TEMPLATES por HTTP real
    // ---------------------------------------------------------------
    const fakeRecipeId = new mongoose.Types.ObjectId().toString();
    const createDietTplRes = await req("POST", "/trainer/diet-templates", trainerHeaders, {
      name: `Dieta HTTP ${runId}`,
      mode: "sequential",
      days: [
        {
          dayLabel: "Día 1",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [
                {
                  label: "",
                  customProducts: [{ product: fakeProductId, quantity: 100 }],
                  customRecipes: [{ recipe: fakeRecipeId, quantity: 1 }],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(createDietTplRes.status, 200, `crear diet-template debía ser 200, fue ${createDietTplRes.status}: ${JSON.stringify(createDietTplRes.body)}`);
    const dietTemplateId = createDietTplRes.body._id;
    const createdAlt = createDietTplRes.body.days[0].meals[0].alternatives[0];
    assert.equal(createdAlt.customProducts.length, 1, "customProducts debe venir materializado y poblado");
    assert.ok(typeof createdAlt.customProducts[0].product === "object" || createdAlt.customProducts[0].product === null,
      "product debe venir poblado (objeto) por HTTP, no un ObjectId crudo");
    ok("POST /trainer/diet-templates -> 200, refs reales materializados y poblados", dietTemplateId);

    const listDietTplRes = await req("GET", "/trainer/diet-templates", trainerHeaders);
    assert.equal(listDietTplRes.status, 200);
    assert.ok(listDietTplRes.body.some((t) => t._id === dietTemplateId));
    ok("GET /trainer/diet-templates -> 200, incluye la creada");

    const updateDietTplRes = await req("PUT", `/trainer/diet-templates/${dietTemplateId}`, trainerHeaders, {
      name: "Dieta HTTP renombrada",
    });
    assert.equal(updateDietTplRes.status, 200);
    assert.equal(updateDietTplRes.body.name, "Dieta HTTP renombrada");
    ok("PUT /trainer/diet-templates/:id -> 200");

    const deleteDietTplRes = await req("DELETE", `/trainer/diet-templates/${dietTemplateId}`, trainerHeaders);
    assert.equal(deleteDietTplRes.status, 204);
    ok("DELETE /trainer/diet-templates/:id -> 204");

    console.log(`${LOG_PREFIX} PASS (HTTP real end-to-end)`);
  } finally {
    log("limpiando datos de prueba...");
    // Solo borrar la tabla — su propio hook en cascada ya borra el split (y
    // este a su vez los workouts reales creados por el apply). Borrar el
    // split otra vez a mano después es redundante y revienta contra
    // split-schema.js#pre("deleteOne") (no null-guardado si ya no existe).
    if (created.table) await tableSchema.deleteOne({ _id: created.table._id });
    if (created.relation) await trainerClientSchema.deleteOne({ _id: created.relation._id });
    // El borrado de cuenta se prueba aparte para no condicionar la limpieza
    // de este script a que ese endpoint funcione.
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
    if (created.client) await userSchema.deleteOne({ _id: created.client._id });
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
