const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-nutrition-history]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-045 (MASTER_BACKLOG.md) — confirma que GET .../nutrition-plans/history
// (vía planAssignmentService.listForClient) trae el planName directo de cada
// copia — ya no hace falta un lookup en lote aparte, porque la copia ES la
// asignación (ver diet-template-schema.js) y ya trae su propio `name`. Y que
// GET .../diet-exceptions lista y ordena bien las excepciones de un cliente.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const planAssignmentService = require("../components/planAssignments/plan-assignment-service");
  const dietExceptionSchema = require("../components/dietExceptions/diet-exception-schema");
  const dietExceptionDao = require("../components/dietExceptions/diet-exception-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    trainer: null,
    client: null,
    assignments: [],
    exceptions: [],
  };

  try {
    created.trainer = await userSchema.create({ email: `verify-nutr-hist-t-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-nutr-hist-c-${runId}@test.local` });

    // Dos fases del histórico — cada una ES su propia copia-asignación, sin
    // plantilla real de por medio (no hace falta para lo que prueba este
    // script).
    const assignment1 = await dietTemplateSchema.create({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      name: `Fase inicial ${runId}`,
      mode: "sequential",
      startDate: "2026-07-01",
      endMode: "fixedDate",
      endDate: "2026-07-31",
      status: "superseded",
    });
    const assignment2 = await dietTemplateSchema.create({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      name: `Fase de definición ${runId}`,
      mode: "sequential",
      startDate: "2026-08-01",
      endMode: "indefinite",
      endDate: null,
      status: "active",
    });
    created.assignments.push(assignment1, assignment2);

    // 1. listForClient trae planName directo, sin lookup aparte.
    const assignments = await planAssignmentService.listForClient(created.client._id.toString());
    assert.equal(assignments.length, 2, "debe haber 2 fases en el historial");
    const byStartDate = Object.fromEntries(assignments.map((a) => [a.startDate, a.name]));
    assert.equal(byStartDate["2026-07-01"], assignment1.name, "la fase de julio debe traer su propio nombre");
    assert.equal(byStartDate["2026-08-01"], assignment2.name, "la fase de agosto debe traer su propio nombre");
    ok("listForClient() trae el nombre de cada fase directo, sin lookup en lote aparte");

    // 2. findAllForClient lista y ordena excepciones por fecha desc.
    const exc1 = await dietExceptionDao.create({
      assignmentId: assignment2._id,
      clientId: created.client._id,
      date: "2026-08-05",
      mealSlot: null,
      action: "skip",
    });
    const exc2 = await dietExceptionDao.create({
      assignmentId: assignment2._id,
      clientId: created.client._id,
      date: "2026-08-10",
      mealSlot: "Cena",
      action: "override",
      override: { customProducts: [], customRecipes: [] },
    });
    created.exceptions.push(exc1, exc2);

    const exceptions = await dietExceptionDao.findAllForClient(created.client._id.toString());
    assert.equal(exceptions.length, 2, "debe listar las 2 excepciones creadas");
    assert.equal(exceptions[0].date, "2026-08-10", "debe venir ordenado por fecha descendente (más reciente primero)");
    assert.equal(exceptions[1].date, "2026-08-05");
    ok("findAllForClient() lista y ordena las excepciones correctamente");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.exceptions.length) {
      await dietExceptionSchema.deleteMany({ _id: { $in: created.exceptions.map((e) => e._id) } });
    }
    if (created.assignments.length) {
      await dietTemplateSchema.deleteMany({ _id: { $in: created.assignments.map((a) => a._id) } });
    }
    if (created.client) await userSchema.deleteOne({ _id: created.client._id });
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
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
