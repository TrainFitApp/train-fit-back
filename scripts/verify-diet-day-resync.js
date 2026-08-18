const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-diet-day-resync]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-006 (MASTER_BACKLOG.md) — script aislado y autolimpiante: confirma
// que un DietDay ya existente pero todavía vacío (autocreado ANTES de que
// hubiera un PlanAssignment activo) se resincroniza la próxima vez que se
// lee, en vez de quedar vacío para siempre pese a que el entrenador ya
// asignó un plan que sí cubre esa fecha. También confirma que un día que ya
// tiene contenido real NO se toca (no se pisa nada).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const planAssignmentDao = require("../components/planAssignments/plan-assignment-dao");
  const dietDayResolver = require("../components/dietDays/diet-day-resolver");
  const dietSchema = require("../components/diets/diet-schema");
  const dietDaySchema = require("../components/dietDays/diet-days-schema");
  const mealSchema = require("../components/meals/meal-schema");
  const customProductSchema = require("../components/customProducts/custom-product-schema");
  const planAssignmentSchema = require("../components/planAssignments/plan-assignment-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const DATE = "2026-08-11";
  const created = {
    trainer: null,
    client: null,
    template: null,
    assignment: null,
  };

  try {
    created.trainer = await userSchema.create({
      email: `verify-diet-resync-trainer-${runId}@test.local`,
    });
    created.client = await userSchema.create({
      email: `verify-diet-resync-client-${runId}@test.local`,
    });
    ok("trainer y cliente de prueba creados");

    // 1. El cliente "abre" el día ANTES de que exista ningún plan — se crea
    //    vacío, comportamiento de siempre.
    const emptyDay = await dietDayResolver.resolveOwnedDietDay(
      created.client._id.toString(),
      DATE,
    );
    assert.ok(emptyDay, "el día debe haberse creado");
    assert.ok(
      emptyDay.meals.every(
        (m) => !(m.customProducts || []).length && !(m.customRecipes || []).length,
      ),
      "el día recién creado sin plan debe estar completamente vacío",
    );
    ok("día creado vacío antes de que exista un plan (comportamiento de siempre)");

    // 2. El entrenador asigna un plan DESPUÉS — mismo escenario real que
    //    describe el hallazgo del audit.
    // customProducts/customRecipes son refs reales desde la unificación
    // Mixed -> refs (2026-08) — hay que pasar por el dao (materializa
    // {product,quantity} en un CustomProduct real), no escribir Mixed crudo
    // directo contra el schema.
    created.template = await dietTemplateDao.create(
      created.trainer._id,
      `Plantilla de prueba ${runId}`,
      [
        {
          dayLabel: "Día 1",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [
                {
                  label: "",
                  customProducts: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 100 }],
                  customRecipes: [],
                },
              ],
            },
          ],
        },
      ],
      "sequential",
      []
    );
    created.assignment = await planAssignmentDao.create({
      planId: created.template._id,
      clientId: created.client._id,
      trainerId: created.trainer._id,
      startDate: DATE,
      endMode: "indefinite",
      endDate: null,
    });
    ok("plantilla + PlanAssignment creados, empieza justo en la fecha del día ya vacío");

    // 3. Antes del fix: volver a leer el mismo día devolvía el mismo día
    //    vacío de siempre — el plan nunca se aplicaba retroactivamente.
    const resyncedDay = await dietDayResolver.resolveOwnedDietDay(
      created.client._id.toString(),
      DATE,
    );
    const desayuno = resyncedDay.meals.find((m) => m.name === "Desayuno");
    assert.ok(
      desayuno && (desayuno.customProducts || []).length > 0,
      "el día ya existente debe haberse resincronizado con el plan recién asignado (era el bug: se quedaba vacío)",
    );
    ok("día ya existente resincronizado correctamente con el plan asignado después de crearlo");

    // 4. Un tercer read no debe duplicar contenido (el día ya no está
    //    "untouched" tras el paso 3).
    const thirdRead = await dietDayResolver.resolveOwnedDietDay(
      created.client._id.toString(),
      DATE,
    );
    const desayuno2 = thirdRead.meals.find((m) => m.name === "Desayuno");
    assert.equal(
      (desayuno2.customProducts || []).length,
      (desayuno.customProducts || []).length,
      "una tercera lectura no debe volver a aplicar el plan (el día ya no está vacío)",
    );
    ok("día con contenido real ya no se vuelve a tocar en lecturas posteriores");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.client) {
      const clientDoc = await userSchema.findById(created.client._id).select("dietInUse");
      if (clientDoc?.dietInUse) {
        const diet = await dietSchema.findById(clientDoc.dietInUse);
        if (diet) {
          for (const dietDay of diet.dietsDay || []) {
            await mealSchema.deleteMany({ _id: { $in: dietDay.meals } });
            await customProductSchema.deleteMany({
              _id: {
                $in: (dietDay.meals || []).flatMap((m) => m.customProducts || []).map((cp) => cp._id || cp),
              },
            });
          }
          await dietDaySchema.deleteMany({ _id: { $in: diet.dietsDay.map((d) => d._id) } });
        }
        await dietSchema.deleteOne({ _id: clientDoc.dietInUse });
      }
    }
    if (created.assignment) await planAssignmentSchema.deleteOne({ _id: created.assignment._id });
    if (created.template) await dietTemplateSchema.deleteOne({ _id: created.template._id });
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
