const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-plan-resolver-sequential-cycle]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

function addDaysToIsoDate(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Confirma que plan-resolver.js#resolvePlanForDate CICLA en modo
// "sequential" en vez de quedarse en null tras la última fecha cubierta por
// `days.length` — bug ya detectado por el propio copy del builder ("¿Cómo se
// repite esta plantilla?") y por el desacople entre nº de días de la
// plantilla y el endMode elegido al aplicar (apply-diet-template-modal.ts).
// Plantilla de 2 días (A/B), asignación de 4 días -> día 0=A, 1=B, 2=A
// (ciclo), 3=B (ciclo).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const planAssignmentService = require("../components/planAssignments/plan-assignment-service");
  const planResolver = require("../components/planAssignments/plan-resolver");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, client: null, template: null, assignment: null };

  try {
    created.trainer = await userSchema.create({ email: `verify-cycle-trainer-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-cycle-client-${runId}@test.local` });
    ok("usuarios de prueba creados");

    // customProducts/customRecipes son refs reales desde la unificación
    // Mixed -> refs (2026-08) — hay que pasar por el dao (materializa
    // {product,quantity} en un CustomProduct real), no escribir Mixed crudo
    // directo contra el schema. `quantity` sirve de marcador distinguible
    // (111=día A, 222=día B) ya que no hay Product real de por medio.
    const fakeProductId = new mongoose.Types.ObjectId().toString();
    created.template = await dietTemplateDao.create(
      created.trainer._id,
      `Plantilla ciclo ${runId}`,
      [
        {
          dayLabel: "Día A",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [{ label: "", customProducts: [{ product: fakeProductId, quantity: 111 }], customRecipes: [] }],
            },
          ],
        },
        {
          dayLabel: "Día B",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [{ label: "", customProducts: [{ product: fakeProductId, quantity: 222 }], customRecipes: [] }],
            },
          ],
        },
      ],
      "sequential",
      []
    );
    ok("plantilla sequential de 2 días creada", created.template._id);

    const startDate = "2026-01-01";
    created.assignment = await planAssignmentService.applyPlan({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      template: created.template,
      startDate,
      endMode: "indefinite",
    });
    ok("copia-asignación indefinite creada, cubre desde", startDate);

    const expected = [111, 222, 111, 222]; // día 0,1,2,3 -> A,B,A(ciclo),B(ciclo)
    for (let i = 0; i < expected.length; i++) {
      const date = addDaysToIsoDate(startDate, i);
      const result = await planResolver.resolvePlanForDate(created.client._id, date);
      assert.ok(result, `día ${i} (${date}) debía resolver contenido, no null`);
      const marker = result.resolved["Desayuno"]?.alternatives?.[0]?.customProducts?.[0]?.quantity;
      assert.equal(marker, expected[i], `día ${i} (${date}) esperaba marker "${expected[i]}", llegó "${marker}"`);
    }
    ok(`ciclo correcto para los 4 días: ${expected.join(",")}`);

    // Día 2 es justo el que ANTES del fix devolvía null (fuera del array de
    // 2 días) — probado explícito además del loop de arriba, por claridad.
    const dayBeyondArray = await planResolver.resolvePlanForDate(created.client._id, addDaysToIsoDate(startDate, 2));
    assert.ok(dayBeyondArray, "día más allá de days.length debe ciclar, no quedar null");
    ok("regresión confirmada: día fuera del array original ahora resuelve por ciclo");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.assignment) await dietTemplateSchema.deleteOne({ _id: created.assignment._id });
    if (created.template) await dietTemplateSchema.deleteOne({ _id: created.template._id });
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
