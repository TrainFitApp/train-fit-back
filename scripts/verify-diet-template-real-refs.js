const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-diet-template-real-refs]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Confirma la migración Mixed -> refs reales de DietTemplate: 1) el
// autopopulate del plugin mongoose-autopopulate SÍ llega a la profundidad
// days[].meals[].alternatives[].customProducts (el riesgo técnico real de
// este cambio, nunca probado a este nivel de anidamiento en el resto de la
// app), 2) update() limpia el CustomProduct/CustomRecipe viejo al reemplazar
// contenido (no deja huérfanos), 3) delete() cascada todo el contenido.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const productSchema = require("../components/products/product-schema");
  const recipeSchema = require("../components/recipes/recipe-schema");
  const customProductSchema = require("../components/customProducts/custom-product-schema");
  const customRecipeSchema = require("../components/customRecipes/custom-recipe-schema");
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const dietTemplateSchema = require("../components/dietTemplates/diet-template-schema");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, product: null, recipe: null, template: null };

  try {
    created.trainer = await userSchema.create({ email: `verify-diet-refs-trainer-${runId}@test.local` });
    created.product = await productSchema.create({ name: `Producto verificación ${runId}`, energyKcal: 100 });
    created.recipe = await recipeSchema.create({ name: `Receta verificación ${runId}` });
    ok("trainer/product/recipe de prueba creados");

    created.template = await dietTemplateDao.create(
      created.trainer._id,
      `Plantilla refs reales ${runId}`,
      [
        {
          dayLabel: "Día 1",
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
      "sequential",
      []
    );
    ok("plantilla creada", created.template._id);

    // --- 1) autopopulate a 4 niveles de profundidad ---
    const fetched = await dietTemplateSchema.findById(created.template._id);
    const alt = fetched.days[0].meals[0].alternatives[0];
    assert.equal(alt.customProducts.length, 1, "debe tener 1 CustomProduct materializado");
    assert.equal(alt.customRecipes.length, 1, "debe tener 1 CustomRecipe materializado");
    assert.ok(
      alt.customProducts[0].product && typeof alt.customProducts[0].product === "object",
      "customProducts[0].product debe venir POBLADO (objeto), no un ObjectId crudo"
    );
    assert.equal(alt.customProducts[0].product.name, `Producto verificación ${runId}`);
    assert.ok(
      alt.customRecipes[0].recipe && typeof alt.customRecipes[0].recipe === "object",
      "customRecipes[0].recipe debe venir POBLADO (objeto), no un ObjectId crudo"
    );
    assert.equal(alt.customRecipes[0].recipe.name, `Receta verificación ${runId}`);
    ok("autopopulate funciona a 4 niveles de profundidad (days.meals.alternatives.customProducts.product)");

    const oldCustomProductId = alt.customProducts[0]._id;
    const oldCustomRecipeId = alt.customRecipes[0]._id;

    // --- 2) update() reemplaza contenido y limpia lo viejo (no huérfanos) ---
    const updated = await dietTemplateDao.update(created.trainer._id, created.template._id, {
      days: [
        {
          dayLabel: "Día 1 editado",
          meals: [
            { slot: "Desayuno", alternatives: [{ label: "", customProducts: [], customRecipes: [] }] },
          ],
        },
      ],
    });
    assert.equal(updated.days[0].dayLabel, "Día 1 editado");
    assert.equal(updated.days[0].meals[0].alternatives[0].customProducts.length, 0);

    const oldProductStillExists = await customProductSchema.findById(oldCustomProductId);
    const oldRecipeStillExists = await customRecipeSchema.findById(oldCustomRecipeId);
    assert.equal(oldProductStillExists, null, "el CustomProduct viejo debe haberse borrado al reemplazar days");
    assert.equal(oldRecipeStillExists, null, "el CustomRecipe viejo debe haberse borrado al reemplazar days");
    ok("update() limpia CustomProduct/CustomRecipe viejo al reemplazar contenido, sin huérfanos");

    // --- 3) delete() cascada el contenido restante ---
    // Vuelve a meter contenido para poder confirmar que delete() también cascada.
    const withContentAgain = await dietTemplateDao.update(created.trainer._id, created.template._id, {
      days: [
        {
          dayLabel: "Día 1",
          meals: [
            {
              slot: "Desayuno",
              alternatives: [{ label: "", customProducts: [{ product: created.product._id.toString(), quantity: 100 }], customRecipes: [] }],
            },
          ],
        },
      ],
    });
    const cpIdBeforeDelete = withContentAgain.days[0].meals[0].alternatives[0].customProducts[0]._id;

    await dietTemplateDao.delete(created.trainer._id, created.template._id);
    const cpAfterDelete = await customProductSchema.findById(cpIdBeforeDelete);
    assert.equal(cpAfterDelete, null, "delete() debe cascadear el CustomProduct restante");
    const templateAfterDelete = await dietTemplateSchema.findById(created.template._id);
    assert.equal(templateAfterDelete, null, "la plantilla debe haberse borrado");
    ok("delete() cascada el contenido restante y borra la plantilla");
    created.template = null; // ya borrada, no reintentar en el finally

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.template) await dietTemplateSchema.deleteOne({ _id: created.template._id });
    if (created.product) await productSchema.deleteOne({ _id: created.product._id });
    if (created.recipe) await recipeSchema.deleteOne({ _id: created.recipe._id });
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
