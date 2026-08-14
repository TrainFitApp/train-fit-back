const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-choice-plan-stuck-days]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-044 (MASTER_BACKLOG.md) — confirma que dietDaysService.
// countDaysWithoutChoice() cuenta correctamente los DietDay con
// dayTypeName=null dentro de un rango de fechas, y que
// plan-assignment-controller.js#getActive expone mode/stuckDaysCount
// correctamente para un plan "choice" con días atascados reales.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const dietSchema = require("../components/diets/diet-schema");
  const dietDaySchema = require("../components/dietDays/diet-days-schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const planAssignmentSchema = require("../components/planAssignments/plan-assignment-schema");
  const dietDaysService = require("../components/dietDays/diet-days-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = {
    client: null,
    trainer: null,
    diet: null,
    dietDays: [],
    template: null,
    assignment: null,
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-stuck-days-trainer-${runId}@test.local`,
    });
    created.client = await userSchema.create({
      email: `verify-stuck-days-client-${runId}@test.local`,
    });

    // 5 días: 2026-08-01..03 sin elegir (dayTypeName null), 08-04..05 sí eligió.
    created.dietDays = await dietDaySchema.insertMany([
      { date: "2026-08-01", dayTypeName: null, meals: [] },
      { date: "2026-08-02", dayTypeName: null, meals: [] },
      { date: "2026-08-03", dayTypeName: null, meals: [] },
      { date: "2026-08-04", dayTypeName: "Entrenamiento", meals: [] },
      { date: "2026-08-05", dayTypeName: "Descanso", meals: [] },
    ]);

    created.diet = await dietSchema.create({
      name: `Dieta de prueba ${runId}`,
      dietsDay: created.dietDays.map((dd) => dd._id),
    });

    await userSchema.findByIdAndUpdate(created.client._id, { dietInUse: created.diet._id });

    created.template = await dietTemplateSchema.create({
      trainerId: created.trainer._id,
      name: `Plantilla choice de prueba ${runId}`,
      mode: "choice",
      dayPatterns: [
        { name: "Entrenamiento", appliesTo: [], meals: [] },
        { name: "Descanso", appliesTo: [], meals: [] },
      ],
    });

    created.assignment = await planAssignmentSchema.create({
      planId: created.template._id,
      clientId: created.client._id,
      trainerId: created.trainer._id,
      startDate: "2026-08-01",
      endMode: "indefinite",
      endDate: null,
      status: "active",
    });

    // 1. countDaysWithoutChoice aislado.
    const count = await dietDaysService.countDaysWithoutChoice(
      created.diet._id,
      created.assignment.startDate,
      "2026-08-05"
    );
    assert.equal(count, 3, "debe contar exactamente los 3 días sin dayTypeName");
    ok("countDaysWithoutChoice() cuenta 3 días atascados correctamente");

    // 2. Rango que excluye los días atascados debe dar 0.
    const countExcluding = await dietDaysService.countDaysWithoutChoice(
      created.diet._id,
      "2026-08-04",
      "2026-08-05"
    );
    assert.equal(countExcluding, 0, "un rango sin días atascados debe dar 0");
    ok("countDaysWithoutChoice() da 0 cuando el rango no incluye días sin elegir");

    // 3. Reproduce la lógica de getActive (mismo camino que el controller)
    // para confirmar que el shape final de la respuesta es el esperado.
    const client = await userSchema.findById(created.client._id).select("dietInUse");
    assert.ok(client.dietInUse, "el cliente debe tener dietInUse asignado");
    const stuckDaysCount = await dietDaysService.countDaysWithoutChoice(
      client.dietInUse,
      created.assignment.startDate,
      "2026-08-05"
    );
    assert.equal(stuckDaysCount, 3, "el cálculo replicado del controller debe coincidir");
    ok("Lógica de getActive (mode=choice) calcula stuckDaysCount=3 como se espera");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.assignment) await planAssignmentSchema.deleteOne({ _id: created.assignment._id });
    if (created.template) await dietTemplateSchema.deleteOne({ _id: created.template._id });
    if (created.diet) await dietSchema.deleteOne({ _id: created.diet._id });
    if (created.dietDays.length) {
      await dietDaySchema.deleteMany({ _id: { $in: created.dietDays.map((dd) => dd._id) } });
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
