const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const DietDay = require("../../components/dietDays/diet-days-schema");
const Recipe = require("../../components/recipes/recipe-schema");
const DietTemplate = require("../../components/dietTemplates/diet-template-schema");
const MealSnippet = require("../../components/mealSnippets/meal-snippet-schema");
const Product = require("../../components/products/product-schema");
const mealStore = require("../../components/meals/meal-store");
const { migrateEmbedNutrition } = require("./04-embed-nutrition");

// Datos en el formato ANTERIOR (colecciones sueltas), sembrados en crudo.
const db = useTestDb();

async function seedOldFormat() {
  const pan = await Product.create({ name: "Pan", energyKcal100g: 250 });
  const tomate = await Product.create({ name: "Tomate", energyKcal100g: 18 });
  const ids = Object.fromEntries(
    ["ingredient", "added", "modified", "cpDay", "cpSnippet", "cpTemplate", "crDay", "crTemplate", "meal0", "meal1", "snippet", "day", "recipe", "template", "orphanCp"].map((name) => [name, db.oid()]),
  );
  await db.raw("customproducts").insertMany([
    { _id: ids.ingredient, product: tomate._id, quantity: 100, __v: 0 },
    { _id: ids.added, product: pan._id, quantity: 20, customRecipeId: ids.crDay },
    { _id: ids.modified, product: tomate._id, quantity: 50, baseCustomProductId: ids.ingredient, customRecipeId: ids.crDay },
    { _id: ids.cpDay, product: pan._id, quantity: 60, mealId: ids.meal0, energyKcal100g: 260, assignedByTrainerId: db.oid(), assignedQuantity: 60 },
    { _id: ids.cpSnippet, product: pan._id, quantity: 40 },
    { _id: ids.cpTemplate, product: tomate._id, quantity: 150 },
    { _id: ids.orphanCp, product: pan._id, quantity: 1 },
  ]);
  await db.raw("customrecipes").insertMany([
    {
      _id: ids.crDay,
      recipe: ids.recipe,
      quantity: 300,
      addedCustomProducts: [ids.added],
      modifiedBaseCustomProducts: [ids.modified, db.oid()],
      removedBaseCustomProductIds: [],
      consumed: true,
      __v: 0,
    },
    { _id: ids.crTemplate, recipe: ids.recipe, quantity: 200, addedCustomProducts: [], modifiedBaseCustomProducts: [] },
  ]);
  await db.raw("recipes").insertOne({ _id: ids.recipe, name: "Tostada con tomate", customProducts: [ids.ingredient], verified: true });
  await db.raw("meals").insertMany([
    { _id: ids.meal0, name: "Desayuno", customProducts: [ids.cpDay, db.oid()], customRecipes: [ids.crDay], completed: true, trainerId: null, __v: 0 },
    { _id: ids.meal1, name: "Almuerzo", notes: "Ligero", customProducts: [], customRecipes: [], alternatives: [{ label: "A", customProducts: [{ quantity: 5 }], customRecipes: [] }], chosenAlternativeIndex: 0 },
    { _id: ids.snippet, name: "Merienda tipo", trainerId: db.oid(), customProducts: [ids.cpSnippet], customRecipes: [] },
  ]);
  await db.raw("dietdays").insertOne({ _id: ids.day, userId: db.oid(), date: "2026-01-10", meals: [ids.meal0, db.oid(), ids.meal1], menuName: "A", __v: 0 });
  await db.raw("diettemplates").insertOne({
    _id: ids.template,
    trainerId: db.oid(),
    name: "Plantilla",
    menus: [{ name: "M", meals: [{ slot: "Comida", alternatives: [{ label: "", customProducts: [ids.cpTemplate], customRecipes: [ids.crTemplate] }] }] }],
  });
  return ids;
}

test("dry-run cuenta lo que haría y no escribe nada", async () => {
  await db.reset();
  await seedOldFormat();
  const stats = await migrateEmbedNutrition(db.mongoose.connection.db, { dryRun: true });
  assert.equal(stats.dietDays, 1);
  assert.equal(stats.snippets, 1);
  assert.equal(stats.recipes, 1);
  assert.equal(stats.dietTemplates, 1);
  assert.equal(stats.danglingMeals, 1);
  assert.equal(stats.danglingProducts, 2);
  assert.equal(stats.orphanCustomProducts, 1);
  assert.ok((await db.raw("dietdays").findOne({})).meals[0]._bsontype, "sigue como referencia");
  assert.equal(await db.raw("mealsnippets").countDocuments(), 0);
});

test("migra conservando ids, orden y contenido; la app lo lee igual; es idempotente", async () => {
  await db.reset();
  const ids = await seedOldFormat();
  const conn = db.mongoose.connection.db;
  await migrateEmbedNutrition(conn);

  const day = await DietDay.findById(ids.day);
  assert.deepEqual(day.meals.map((meal) => String(meal._id)), [String(ids.meal0), String(ids.meal1)]);
  const breakfast = day.meals[0];
  assert.equal(breakfast.completed, undefined, "Meal.completed desaparece");
  assert.equal(breakfast.customProducts[0].consumed, true, "lo pautado de una comida hecha queda tomado");
  assert.equal(breakfast.customProducts[0].mealId, undefined);
  assert.equal(String(breakfast.customProducts[0]._id), String(ids.cpDay));
  assert.equal(breakfast.customProducts[0].product.name, "Pan", "el Product se sigue poblando");
  assert.equal(breakfast.customProducts[0].energyKcal100g, 260);
  assert.ok(breakfast.customProducts[0].assignedByTrainerId);
  const recipeInMeal = breakfast.customRecipes[0];
  assert.equal(String(recipeInMeal._id), String(ids.crDay));
  assert.equal(recipeInMeal.recipe.name, "Tostada con tomate");
  assert.equal(recipeInMeal.recipe.customProducts[0].product.name, "Tomate", "ingredientes de la receta embebidos y poblados");
  assert.equal(String(recipeInMeal.addedCustomProducts[0]._id), String(ids.added));
  assert.equal(recipeInMeal.modifiedBaseCustomProducts.length, 1, "la ref colgante se descarta");
  assert.equal(String(recipeInMeal.modifiedBaseCustomProducts[0].baseCustomProductId), String(ids.ingredient));
  assert.equal(recipeInMeal.consumed, true);
  assert.equal(day.meals[1].notes, "Ligero");
  assert.equal(day.meals[1].alternatives[0].label, "A");

  // Las rutas por id encuentran cada pieza.
  assert.equal(String((await mealStore.readMealItem(ids.cpDay, "customProducts"))._id), String(ids.cpDay));
  assert.equal(String(await mealStore.findMealIdContaining(ids.crDay, "customRecipes")), String(ids.meal0));

  const snippet = await MealSnippet.findById(ids.snippet);
  assert.equal(snippet.name, "Merienda tipo");
  assert.equal(snippet.customProducts[0].product.name, "Pan");
  assert.equal(String((await mealStore.readMeal(ids.snippet))._id), String(ids.snippet));

  const template = await DietTemplate.findById(ids.template);
  const alternative = template.menus[0].meals[0].alternatives[0];
  assert.equal(String(alternative.customProducts[0]._id), String(ids.cpTemplate));
  assert.equal(alternative.customRecipes[0].recipe.name, "Tostada con tomate");

  const recipe = await Recipe.findById(ids.recipe).lean();
  assert.equal(String(recipe.customProducts[0]._id), String(ids.ingredient));

  const again = await migrateEmbedNutrition(conn);
  assert.equal(again.dietDays + again.snippets + again.recipes + again.dietTemplates, 0);

  const dropped = await migrateEmbedNutrition(conn, { dropOld: true });
  assert.deepEqual(dropped.dropped.sort(), ["customproducts", "customrecipes", "meals"]);
});
