const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const {
  TAG_HIGH_PROTEIN,
  TAG_VEGAN,
  TAG_VEGETARIAN,
  buildRecipeDocument,
  checkPantry,
  dietTags,
  nutritionTags,
  planSeed,
  seedVerifiedRecipes,
} = require("./seed-verified-recipes");
const { PANTRY, RECIPES } = require("./data/verified-recipes");

const db = useTestDb();

const MEAL_TAGS = new Set(["desayuno", "comida", "cena", "snack", "postre"]);
const DISH_TAGS = new Set(["batido", "ensalada", "pasta", "arroz", "legumbres", "sopa"]);
const KINDS = new Set(["carne", "pescado", "huevo", "lacteo", "miel", "vegetal"]);

// ─── Recetario ─────────────────────────────────────────────────────────

test("el recetario tiene más de 200 recetas con nombre único", () => {
  assert.ok(RECIPES.length > 200, `solo hay ${RECIPES.length}`);
  const names = RECIPES.map((recipe) => recipe.name.trim().toLowerCase());
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(repeated, []);
});

test("cada receta cabe en el schema y usa claves de la despensa", () => {
  for (const recipe of RECIPES) {
    const where = `"${recipe.name}"`;
    assert.ok(recipe.name.length > 0 && recipe.name.length <= 100, `${where}: nombre de 1 a 100 caracteres`);
    assert.ok(recipe.tags.some((tag) => MEAL_TAGS.has(tag)), `${where}: sin momento del día`);
    for (const tag of recipe.tags) assert.ok(MEAL_TAGS.has(tag) || DISH_TAGS.has(tag), `${where}: etiqueta desconocida "${tag}"`);

    assert.ok(recipe.ingredients.length > 0, `${where}: sin ingredientes`);
    const keys = recipe.ingredients.map(([key]) => key);
    assert.equal(new Set(keys).size, keys.length, `${where}: ingrediente repetido`);
    for (const [key, grams] of recipe.ingredients) {
      assert.ok(PANTRY[key], `${where}: "${key}" no está en la despensa`);
      assert.ok(Number.isFinite(grams) && grams > 0 && grams <= 1000, `${where}: cantidad de "${key}" fuera de rango`);
    }

    // El front parte `description` en pasos por saltos de línea (máx. 20 de
    // 300 caracteres) y el schema la limita a 2000.
    assert.ok(recipe.steps.length > 0 && recipe.steps.length <= 20, `${where}: de 1 a 20 pasos`);
    for (const step of recipe.steps) {
      assert.ok(step.trim().length > 0 && step.length <= 300, `${where}: paso vacío o de más de 300 caracteres`);
      assert.ok(!step.includes("\n"), `${where}: un paso no puede llevar saltos de línea`);
    }
    assert.ok(recipe.steps.join("\n").length <= 2000, `${where}: descripción de más de 2000 caracteres`);
  }
});

test("la despensa apunta a productos distintos y no tiene entradas sin usar", () => {
  const entries = Object.entries(PANTRY);
  const ids = entries.map(([, entry]) => entry.product);
  const codes = entries.map(([, entry]) => entry.code);
  assert.equal(new Set(ids).size, ids.length, "dos claves con el mismo producto");
  assert.equal(new Set(codes).size, codes.length, "dos claves con el mismo código");
  for (const [key, entry] of entries) {
    assert.match(entry.product, /^[0-9a-f]{24}$/, `${key}: _id no válido`);
    assert.ok(entry.code && entry.label && entry.name, `${key}: le falta código, etiqueta o nombre`);
    assert.ok(KINDS.has(entry.kind), `${key}: kind desconocido "${entry.kind}"`);
  }
  const used = new Set(RECIPES.flatMap((recipe) => recipe.ingredients.map(([key]) => key)));
  assert.deepEqual(Object.keys(PANTRY).filter((key) => !used.has(key)), []);
});

// ─── Lógica pura ───────────────────────────────────────────────────────

const pantry = {
  avena: { product: "6928f4bbcdbf40e64b9de131", code: "1", kind: "vegetal" },
  yogur: { product: "6928f4bbcdbf40e64b9ddf71", code: "2", kind: "lacteo" },
  miel: { product: "6928f4bdcdbf40e64b9dfa9b", code: "3", kind: "miel" },
  pollo: { product: "6928f4bccdbf40e64b9df14a", code: "4", kind: "carne" },
};

test("deduce vegetariana y vegana de los ingredientes", () => {
  assert.deepEqual(dietTags([["avena", 50]], pantry), [TAG_VEGETARIAN, TAG_VEGAN]);
  assert.deepEqual(dietTags([["avena", 50], ["yogur", 100]], pantry), [TAG_VEGETARIAN]);
  assert.deepEqual(dietTags([["avena", 50], ["miel", 10]], pantry), [TAG_VEGETARIAN], "la miel no es vegana");
  assert.deepEqual(dietTags([["avena", 50], ["pollo", 100]], pantry), []);
});

test("alta en proteína cuando la proteína aporta al menos el 20 % de la energía", () => {
  const products = new Map([
    ["avena", { energyKcal100g: 375, protein100g: 12.5 }],
    ["pollo", { energyKcal100g: 100, protein100g: 25 }],
  ]);
  // 50 g de avena: 187,5 kcal y 6,25 g de proteína (13 %).
  assert.deepEqual(nutritionTags([["avena", 50]], products), []);
  // + 100 g de pollo: 287,5 kcal y 31,25 g (43 %).
  assert.deepEqual(nutritionTags([["avena", 50], ["pollo", 100]], products), [TAG_HIGH_PROTEIN]);
  // Sin valores conocidos no se etiqueta.
  assert.deepEqual(nutritionTags([["yogur", 100]], products), []);
});

test("construye la receta verificada, sin dueño y con los ingredientes embebidos", () => {
  const products = new Map([["pollo", { energyKcal100g: 100, protein100g: 25 }]]);
  const doc = buildRecipeDocument(
    { name: "Pollo", tags: ["comida", "cena"], ingredients: [["pollo", 150], ["avena", 20]], steps: ["Paso uno.", "Paso dos."] },
    { pantry, productsByKey: products },
  );
  assert.equal(doc.name, "Pollo");
  assert.equal(doc.description, "Paso uno.\nPaso dos.");
  assert.equal(doc.verified, true);
  assert.equal("userId" in doc, false);
  assert.deepEqual(doc.tags, ["comida", "cena", TAG_HIGH_PROTEIN]);
  assert.deepEqual(
    doc.customProducts.map(({ product, quantity }) => [String(product), quantity]),
    [[pantry.pollo.product, 150], [pantry.avena.product, 20]],
  );
  assert.ok(doc.customProducts.every((item) => item._id), "cada ingrediente lleva su _id");
});

test("solo usa los productos que existen y conservan su código", () => {
  const { productsByKey, missing, mismatched } = checkPantry(pantry, [
    { _id: pantry.avena.product, code: "1" },
    { _id: pantry.yogur.product, code: "otro" },
    { _id: pantry.miel.product, code: "3" },
  ]);
  assert.deepEqual([...productsByKey.keys()], ["avena", "miel"]);
  assert.deepEqual(missing, ["pollo"]);
  assert.deepEqual(mismatched, ["yogur"]);
});

test("planifica: crea lo que falta, respeta lo que existe y bloquea lo que no tiene productos", () => {
  const recipes = [
    { name: "A", ingredients: [["avena", 50]] },
    { name: "B", ingredients: [["avena", 50], ["pollo", 100]] },
    { name: "C", ingredients: [["yogur", 100]] },
  ];
  const plan = planSeed({ recipes, availableKeys: new Set(["avena", "yogur"]), existingNames: new Set(["C"]) });
  assert.deepEqual(plan.toCreate.map((recipe) => recipe.name), ["A"]);
  assert.deepEqual(plan.existing.map((recipe) => recipe.name), ["C"]);
  assert.deepEqual(plan.blocked.map(({ recipe, missingKeys }) => [recipe.name, missingKeys]), [["B", ["pollo"]]]);
});

// ─── Contra la base de datos ───────────────────────────────────────────

// Los productos de la despensa, con su _id y su código; valores por 100 g
// de relleno salvo para los que se comprueban.
async function seedPantryProducts({ skip = [] } = {}) {
  const docs = Object.entries(PANTRY)
    .filter(([key]) => !skip.includes(key))
    .map(([key, entry]) => ({
      _id: db.oid(entry.product),
      code: entry.code,
      name: entry.name,
      energyKcal100g: 100,
      protein100g: key === "pollo_pechuga" ? 25 : 1,
      carbohydrates100g: 10,
      fat100g: 1,
    }));
  await db.raw("products").insertMany(docs);
}

const recipeCount = () => db.raw("recipes").countDocuments({});

test("siembra todas las recetas verificadas, buscables y con sus productos", async () => {
  await db.reset();
  await seedPantryProducts();

  const stats = await seedVerifiedRecipes();
  assert.deepEqual(stats, {
    recipes: RECIPES.length,
    created: RECIPES.length,
    toCreate: RECIPES.length,
    existing: 0,
    blocked: 0,
    missingProducts: 0,
  });
  assert.equal(await recipeCount(), RECIPES.length);

  const sample = RECIPES.find((recipe) => recipe.name === "Pollo teriyaki con arroz y brócoli");
  const saved = await db.raw("recipes").findOne({ name: sample.name });
  assert.equal(saved.verified, true);
  assert.equal("userId" in saved, false);
  assert.equal(saved.description, sample.steps.join("\n"));
  assert.ok(saved.searchTokens.includes("teriyaki"), "los derivados de búsqueda los pone el schema");
  assert.deepEqual(
    saved.customProducts.map(({ product, quantity }) => [String(product), quantity]),
    sample.ingredients.map(([key, grams]) => [PANTRY[key].product, grams]),
  );
  assert.ok(saved.tags.includes(TAG_HIGH_PROTEIN), "150 g de pollo a 25 g/100 g con lo demás a 1 g");

  const vegan = await db.raw("recipes").findOne({ name: "Chili vegano de alubias" });
  assert.ok(vegan.tags.includes(TAG_VEGAN) && vegan.tags.includes(TAG_VEGETARIAN));
});

test("es idempotente: una segunda pasada no crea ni toca nada", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedVerifiedRecipes();
  const before = await db.raw("recipes").findOne({ name: "Sopa minestrone" });

  const stats = await seedVerifiedRecipes();
  assert.equal(stats.created, 0);
  assert.equal(stats.existing, RECIPES.length);
  assert.equal(await recipeCount(), RECIPES.length);
  const after = await db.raw("recipes").findOne({ name: "Sopa minestrone" });
  assert.deepEqual(after.customProducts, before.customProducts, "no reescribe los ingredientes");
});

test("una receta con el mismo nombre pero de un usuario no cuenta como existente", async () => {
  await db.reset();
  await seedPantryProducts();
  await db.raw("recipes").insertOne({ name: "Sopa minestrone", verified: false, userId: db.oid(), customProducts: [] });

  const stats = await seedVerifiedRecipes();
  assert.equal(stats.created, RECIPES.length);
  assert.equal(await db.raw("recipes").countDocuments({ name: "Sopa minestrone" }), 2);
});

test("--dry-run informa sin escribir", async () => {
  await db.reset();
  await seedPantryProducts();

  const stats = await seedVerifiedRecipes({ dryRun: true });
  assert.equal(stats.toCreate, RECIPES.length);
  assert.equal(stats.created, 0);
  assert.equal(await recipeCount(), 0);
});

test("sin un producto, solo se quedan fuera las recetas que lo usan", async () => {
  await db.reset();
  await seedPantryProducts({ skip: ["chorizo"] });
  const lines = [];

  const stats = await seedVerifiedRecipes({ log: (line) => lines.push(line) });
  const withChorizo = RECIPES.filter((recipe) => recipe.ingredients.some(([key]) => key === "chorizo"));
  assert.ok(withChorizo.length > 0);
  assert.equal(stats.blocked, withChorizo.length);
  assert.equal(stats.missingProducts, 1);
  assert.equal(await recipeCount(), RECIPES.length - withChorizo.length);
  assert.equal(await db.raw("recipes").countDocuments({ name: withChorizo[0].name }), 0);
  assert.ok(lines.some((line) => line.includes('falta el producto de "chorizo"')));
});

test("no escribe nada si la base sigue en el modelo viejo", async () => {
  await db.reset();
  await seedPantryProducts();
  await db.raw("recipes").insertOne({ name: "Vieja", verified: true, customProducts: [db.oid()] });

  await assert.rejects(seedVerifiedRecipes(), /npm run migrate\./);
  assert.equal(await recipeCount(), 1);
});
