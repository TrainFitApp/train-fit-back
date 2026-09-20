const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-diet-template-assignment-copy]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Confirma "las plantillas nunca se asignan directamente, y ya no hace falta
// una colección PlanAssignment aparte" (revisión de modelo de datos,
// nutrición): 1) applyPlan() congela una COPIA de la plantilla en la MISMA
// colección DietTemplate, con sus propios campos de fecha/estado — nunca
// reusa el _id de la plantilla, 2) esa copia no comparte CustomProduct/
// CustomRecipe con la plantilla original — es un clon real, no una
// referencia, 3) listByTrainer nunca muestra una copia ya asignada, 4)
// editar la plantilla original después de asignarla NO afecta a la copia ya
// asignada (el bug que motivó todo esto), 5) borrar la copia (= borrar la
// asignación, son el mismo documento) cascada correctamente pero nunca toca
// la plantilla real, compartible.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const productSchema = require("../components/products/product-schema");
  const recipeSchema = require("../components/recipes/recipe-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");
  const planAssignmentService = require("../components/planAssignments/plan-assignment-service");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, client: null, product: null, recipe: null, template: null, assignment: null };

  try {
    created.trainer = await userSchema.create({ email: `verify-assign-copy-trainer-${runId}@test.local` });
    created.client = await userSchema.create({ email: `verify-assign-copy-client-${runId}@test.local` });
    created.product = await productSchema.create({ name: `Producto asignación ${runId}`, energyKcal: 100 });
    created.recipe = await recipeSchema.create({ name: `Receta asignación ${runId}` });
    ok("trainer/client/product/recipe de prueba creados");

    created.template = await dietTemplateDao.create(
      created.trainer._id,
      `Plantilla original ${runId}`,
      [
        {
          name: "Menú 1",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [
                {
                  label: "",
                  customProducts: [{ product: created.product._id.toString(), quantity: 150 }],
                  customRecipes: [{ recipe: created.recipe._id.toString(), quantity: 1 }],
                },
              ],
            },
          ],
        },
      ],
    );
    const originalAlt = created.template.menus[0].meals[0].alternatives[0];
    const originalCustomProductId = String(originalAlt.customProducts[0]._id);
    const originalCustomRecipeId = String(originalAlt.customRecipes[0]._id);
    ok("plantilla original creada", created.template._id);

    // --- 1) applyPlan() congela una copia, nunca reusa el _id de la plantilla ---
    const startDate = new Date().toISOString().slice(0, 10);
    const assignment = await planAssignmentService.applyPlan({
      trainerId: created.trainer._id,
      clientId: created.client._id,
      template: created.template,
      startDate,
      endMode: "indefinite",
    });
    created.assignment = assignment;
    assert.notEqual(
      String(assignment._id),
      String(created.template._id),
      "la copia-asignación NUNCA debe ser el mismo documento que la plantilla original"
    );
    ok("applyPlan() no reusa el _id de la plantilla — creó una copia", assignment._id);

    // --- 2) la copia es un clon real: mismo contenido + campos de fecha/estado propios ---
    const frozenCopy = await dietTemplateSchema.findById(assignment._id);
    assert.ok(frozenCopy, "la copia congelada debe existir");
    assert.equal(String(frozenCopy.clientId), String(created.client._id), "clientId debe ser el del cliente asignado");
    assert.equal(String(frozenCopy.trainerId), String(created.trainer._id));
    assert.equal(String(frozenCopy.sourceTemplateId), String(created.template._id), "sourceTemplateId debe apuntar a la plantilla real");
    assert.equal(frozenCopy.startDate, startDate);
    assert.equal(frozenCopy.endMode, "indefinite");
    assert.equal(frozenCopy.status, "active");
    assert.equal(frozenCopy.menus[0].meals[0].alternatives[0].customProducts[0].product.name, `Producto asignación ${runId}`);
    const copyCustomProductId = String(frozenCopy.menus[0].meals[0].alternatives[0].customProducts[0]._id);
    const copyCustomRecipeId = String(frozenCopy.menus[0].meals[0].alternatives[0].customRecipes[0]._id);
    assert.notEqual(copyCustomProductId, originalCustomProductId, "la copia no debe compartir el CustomProduct con la plantilla");
    assert.notEqual(copyCustomRecipeId, originalCustomRecipeId, "la copia no debe compartir el CustomRecipe con la plantilla");
    ok("la copia es un clon real con sus propios campos de fecha/estado");

    // --- 3) listByTrainer nunca muestra una copia ya asignada ---
    const myTemplates = await dietTemplateDao.listByTrainer(created.trainer._id);
    assert.equal(myTemplates.length, 1, "listByTrainer debe ver solo la plantilla real, nunca la copia");
    assert.equal(String(myTemplates[0]._id), String(created.template._id));
    ok("listByTrainer excluye la copia congelada");

    // --- 4) editar la plantilla original después de asignar NO afecta a la copia ---
    await dietTemplateDao.update(created.trainer._id, created.template._id, {
      name: `Plantilla EDITADA ${runId}`,
      menus: [
        {
          name: "Menú 1 editado",
          meals: [{ slot: "Desayuno", alternatives: [{ label: "", customProducts: [], customRecipes: [] }] }],
        },
      ],
    });
    const copyAfterEdit = await dietTemplateSchema.findById(assignment._id);
    assert.equal(copyAfterEdit.menus[0].name, "Menú 1", "la copia ya asignada no debe cambiar cuando se edita la plantilla original");
    assert.equal(
      copyAfterEdit.menus[0].meals[0].alternatives[0].customProducts.length,
      1,
      "la copia ya asignada debe conservar su contenido original"
    );
    ok("editar la plantilla original NO afecta a un cliente ya asignado (bug corregido)");

    // --- 5) borrar la copia-asignación cascada correctamente, nunca toca la plantilla real ---
    await dietTemplateSchema.deleteOne({ _id: assignment._id });
    created.assignment = null;
    const copyAfterDelete = await dietTemplateSchema.findById(assignment._id);
    assert.equal(copyAfterDelete, null, "la copia debe haberse borrado");
    const templateAfterDelete = await dietTemplateSchema.findById(created.template._id);
    assert.ok(templateAfterDelete, "borrar la copia-asignación NUNCA debe tocar la plantilla real (compartible)");
    ok("borrar la copia-asignación no afecta a la plantilla real");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.assignment) await dietTemplateSchema.deleteOne({ _id: created.assignment._id });
    if (created.template) await dietTemplateSchema.deleteOne({ _id: created.template._id });
    if (created.product) await productSchema.deleteOne({ _id: created.product._id });
    if (created.recipe) await recipeSchema.deleteOne({ _id: created.recipe._id });
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
