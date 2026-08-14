const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-recipe-tags]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-046 (MASTER_BACKLOG.md) — confirma que Recipe.tags se guarda al
// crear/editar y que recipeModel.searchRecipes filtra correctamente por tags
// (AND con el resto de baseQuery, no solo un post-filtro cosmético).
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const recipeSchema = require("../components/recipes/recipe-schema");
  const recipeModel = require("../components/recipes/recipe-model");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { user: null, recipes: [] };

  try {
    created.user = await userSchema.create({
      email: `verify-recipe-tags-${runId}@test.local`,
    });

    // 1. createRecipe guarda tags.
    const italian = await recipeModel.createRecipe({
      name: `Pasta de prueba ${runId}`,
      customProducts: [],
      tags: ["italiana", "vegetariana"],
      userId: created.user._id,
    });
    created.recipes.push(italian);
    assert.deepEqual(italian.tags, ["italiana", "vegetariana"], "createRecipe debe persistir tags");
    ok("createRecipe() persiste tags correctamente");

    const mexican = await recipeModel.createRecipe({
      name: `Tacos de prueba ${runId}`,
      customProducts: [],
      tags: ["mexicana"],
      userId: created.user._id,
    });
    created.recipes.push(mexican);

    const untagged = await recipeModel.createRecipe({
      name: `Receta sin tags ${runId}`,
      customProducts: [],
      userId: created.user._id,
    });
    created.recipes.push(untagged);
    assert.deepEqual(untagged.tags, [], "sin tags debe quedar array vacío, no undefined/null");
    ok("createRecipe() sin tags no rompe (default [])");

    // 2. searchRecipes filtra por tags — solo debe volver "italiana".
    const filtered = await recipeModel.searchRecipes(0, 20, "", created.user._id.toString(), {
      ownOnly: true,
      tags: ["italiana"],
    });
    const filteredNames = filtered.map((r) => r.name);
    assert.ok(filteredNames.includes(italian.name), "debe incluir la receta con el tag buscado");
    assert.ok(!filteredNames.includes(mexican.name), "no debe incluir una receta con otro tag");
    assert.ok(!filteredNames.includes(untagged.name), "no debe incluir una receta sin tags");
    ok("searchRecipes() con filtro de tags devuelve solo las recetas correctas");

    // 3. Sin filtro de tags, las 3 deben aparecer (comportamiento no roto).
    const unfiltered = await recipeModel.searchRecipes(0, 20, "", created.user._id.toString(), {
      ownOnly: true,
    });
    const unfilteredNames = unfiltered.map((r) => r.name);
    assert.ok(unfilteredNames.includes(italian.name), "sin filtro deben aparecer todas");
    assert.ok(unfilteredNames.includes(mexican.name), "sin filtro deben aparecer todas");
    assert.ok(unfilteredNames.includes(untagged.name), "sin filtro deben aparecer todas");
    ok("searchRecipes() sin filtro de tags mantiene el comportamiento previo intacto");

    // 4. updateRecipe puede cambiar tags de una receta existente.
    const updated = await require("../components/recipes/recipe-dao").updateRecipe(untagged._id, {
      tags: ["postre"],
    });
    assert.deepEqual(updated.tags, ["postre"], "updateRecipe debe poder asignar tags a una receta que no tenía");
    ok("updateRecipe() asigna tags correctamente a una receta existente");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.recipes.length) {
      await recipeSchema.deleteMany({ _id: { $in: created.recipes.map((r) => r._id) } });
    }
    if (created.user) await userSchema.deleteOne({ _id: created.user._id });
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
