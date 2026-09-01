const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-diet-create-direct]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// "Crear dieta" — confirma que planAssignmentService.createDirectPlan() 1)
// crea una copia-asignación con contenido propio, sin plantilla de origen
// (sourceTemplateId: null, estado válido, no un huérfano), 2) esa copia
// nunca aparece en listByTrainer (no es una plantilla reutilizable), 3)
// respeta la misma validación de solape de fechas que applyPlan (mismo
// reserveActivePhaseSlot compartido), y 4) encadena (supersededBy) igual que
// applyPlan cuando ya había una fase activa.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const productSchema = require("../components/products/product-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const planAssignmentService = require("../components/planAssignments/plan-assignment-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, client: null, product: null, assignments: [] };

  try {
    created.trainer = await userSchema.create({ email: `verify-create-direct-trainer-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-create-direct-client-${runId}@test.local` });
    created.product = await productSchema.create({ name: `Producto directo ${runId}`, energyKcal: 120 });
    ok("trainer/client/product de prueba creados");

    // --- 1) createDirectPlan crea contenido propio, sin plantilla de origen ---
    const days = [
      {
        dayLabel: "Día 1",
        meals: [
          {
            slot: "Desayuno",
            alternatives: [
              { label: "", customProducts: [{ product: created.product._id.toString(), quantity: 200 }], customRecipes: [] },
            ],
          },
        ],
      },
    ];

    const assignment1 = await planAssignmentService.createDirectPlan({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      name: `Dieta directa ${runId}`,
      days,
      mode: "sequential",
      dayPatterns: [],
      startDate: "2026-01-01",
      endMode: "fixedDate",
      fixedEndDate: "2026-01-31",
    });
    created.assignments.push(assignment1);

    assert.equal(String(assignment1.clientId), String(created.client._id));
    assert.equal(assignment1.sourceTemplateId, null, "sin plantilla de origen, sourceTemplateId debe ser null");
    assert.equal(assignment1.status, "active");
    assert.equal(assignment1.startDate, "2026-01-01");
    assert.equal(assignment1.endDate, "2026-01-31");

    const fetched = await dietTemplateSchema.findById(assignment1._id);
    assert.equal(fetched.days[0].meals[0].alternatives[0].customProducts[0].product.name, `Producto directo ${runId}`);
    ok("createDirectPlan() crea contenido propio con sourceTemplateId: null");

    // --- 2) nunca aparece en listByTrainer ---
    const myTemplates = await dietTemplateDao.listByTrainer(created.trainer._id);
    assert.equal(myTemplates.length, 0, "una dieta creada directa no debe aparecer como plantilla reutilizable");
    ok("listByTrainer no muestra la dieta creada directa");

    // --- 3) misma validación de solape que applyPlan ---
    await assert.rejects(
      () =>
        planAssignmentService.createDirectPlan({
          trainerId: created.trainer._id,
          clientId: created.client._id,
          name: "Solapada",
          days: [],
          mode: "sequential",
          dayPatterns: [],
          startDate: "2026-01-15",
          endMode: "indefinite",
        }),
      (error) => error.code === "PLAN_OVERLAP",
      "debe rechazar una fecha que se solapa con la fase activa"
    );
    ok("createDirectPlan() respeta la validación de solape (reserveActivePhaseSlot compartido)");

    // --- 4) encadena supersededBy igual que applyPlan ---
    const assignment2 = await planAssignmentService.createDirectPlan({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      name: `Dieta directa fase 2 ${runId}`,
      days: [],
      mode: "sequential",
      dayPatterns: [],
      startDate: "2026-02-01",
      endMode: "indefinite",
    });
    created.assignments.push(assignment2);

    const assignment1After = await dietTemplateSchema.findById(assignment1._id);
    assert.equal(assignment1After.status, "superseded");
    assert.equal(String(assignment1After.supersededBy), String(assignment2._id));
    ok("createDirectPlan() encadena la fase anterior igual que applyPlan");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.assignments.length) {
      await dietTemplateSchema.deleteMany({ _id: { $in: created.assignments.map((a) => a._id) } });
    }
    if (created.product) await productSchema.deleteOne({ _id: created.product._id });
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
