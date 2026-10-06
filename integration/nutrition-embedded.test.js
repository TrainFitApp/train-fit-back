const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Nutrición con el contenido EMBEBIDO (2026-10): comidas dentro del día,
// alimentos y recetas dentro de la comida, ingredientes dentro de la receta,
// comidas guardadas del entrenador en su propia colección. Lo que aquí se
// comprueba es que nada se pierde ni se comparte entre copias.

const ctx = h.setup();

let foods;
ctx.before(async () => {
  const Product = ctx.model("Product");
  foods = {
    tomate: await Product.create({ name: "Tomate", energyKcal100g: 18, protein100g: 0.9, verified: true }),
    aceite: await Product.create({ name: "Aceite", energyKcal100g: 884, fat100g: 100, verified: true }),
    queso: await Product.create({ name: "Queso", energyKcal100g: 350, protein100g: 25, fat100g: 28, verified: true }),
  };
});

const PREMIUM = { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() + 86400000) } };
const readDay = async (user, date) => (await ctx.post(user, `/dietdays/date/${date}`, {})).dietDay;
const ingredient = (product, quantity) => ({ product: String(product._id), quantity });

// Editar la receta puesta en una comida: lo que hace la app desde la ficha de
// la receta (POST /recipes/compose en modo edición). Manda la instancia
// entera, como la app.
async function editRecipeInMeal(user, mealId, instance, changes) {
  const recipeId = instance.recipe?._id || instance.recipe;
  const res = await ctx.post(user, "/recipes/compose", {
    mode: "edit",
    recipeId,
    customRecipe: {
      quantity: instance.quantity,
      addedCustomProducts: instance.addedCustomProducts || [],
      modifiedBaseCustomProducts: instance.modifiedBaseCustomProducts || [],
      removedBaseCustomProductIds: instance.removedBaseCustomProductIds || [],
      ...changes,
    },
    context: { mealId, customRecipeId: instance._id },
  });
  return res.customRecipe;
}

async function recipeInMeal(user, date, indexMeal = 2, name = "Ensalada") {
  return ctx.post(user, "/recipes/compose", {
    recipe: { name, customProducts: [ingredient(foods.tomate, 200), ingredient(foods.aceite, 10)] },
    customRecipe: { quantity: 150 },
    context: { indexMeal, currentDate: date },
  });
}

test("receta en el diario: se crea en su comida, se edita y se borra", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM });
  const date = "2026-03-01";
  const { recipe } = await recipeInMeal(user, date);
  let day = await readDay(user, date);
  const meal = day.meals[2];
  assert.equal(meal.customRecipes.length, 1);
  const instance = meal.customRecipes[0];
  assert.equal(instance.recipe.name, "Ensalada");
  assert.equal(instance.recipe.customProducts[0].product.name, "Tomate", "los ingredientes de la receta llegan poblados");

  const tomate = instance.recipe.customProducts.find((cp) => cp.product.name === "Tomate");
  const updated = await editRecipeInMeal(user, meal._id, instance, {
    quantity: 300,
    addedCustomProducts: [ingredient(foods.queso, 40)],
    modifiedBaseCustomProducts: [{ baseCustomProductId: tomate._id, quantity: 100 }],
  });
  assert.equal(updated.quantity, 300);
  assert.equal(updated.addedCustomProducts[0].product.name, "Queso");
  assert.equal(String(updated.modifiedBaseCustomProducts[0].baseCustomProductId), String(tomate._id));
  assert.equal(String(updated.modifiedBaseCustomProducts[0].product._id), String(foods.tomate._id), "el producto sale del ingrediente base");
  assert.equal(updated.addedCustomProducts[0].customRecipeId, undefined, "un ingrediente no guarda a qué receta pertenece: va dentro");

  // Editar otra vez conserva los ids de lo que ya estaba.
  const again = await editRecipeInMeal(user, meal._id, updated, {
    addedCustomProducts: [{ _id: updated.addedCustomProducts[0]._id, ...ingredient(foods.queso, 60) }],
  });
  assert.equal(String(again.addedCustomProducts[0]._id), String(updated.addedCustomProducts[0]._id));
  assert.equal(again.addedCustomProducts[0].quantity, 60);
  assert.equal(again.modifiedBaseCustomProducts.length, 1);

  // Quitar un ingrediente de la receta descarta las modificaciones que lo usaban.
  await ctx.put(user, `/recipes/${recipe._id}`, {
    name: "Ensalada",
    customProducts: instance.recipe.customProducts.filter((cp) => cp._id !== tomate._id).map((cp) => ({ _id: cp._id, product: cp.product._id, quantity: cp.quantity })),
  });
  day = await readDay(user, date);
  assert.equal(day.meals[2].customRecipes[0].modifiedBaseCustomProducts.length, 0);

  assert.equal((await ctx.call(user, "DELETE", `/meals/${meal._id}/customrecipes/${instance._id}`)).status, 200);
  day = await readDay(user, date);
  assert.equal(day.meals[2].customRecipes.length, 0);
});

test("recetas recientes de una comida: salen pobladas (receta con ingredientes y productos de lo añadido)", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM });
  await recipeInMeal(user, "2026-03-05", 2, "Gazpacho");
  const meal = (await readDay(user, "2026-03-05")).meals[2];
  await editRecipeInMeal(user, meal._id, meal.customRecipes[0], { addedCustomProducts: [ingredient(foods.queso, 20)] });

  const recents = await ctx.get(user, "/recent-foods/recipes?mealIndex=2");
  assert.equal(recents.length, 1);
  assert.equal(recents[0].recipe.name, "Gazpacho");
  assert.equal(recents[0].recipe.customProducts[0].product.name, "Tomate");
  assert.equal(recents[0].addedCustomProducts[0].product.name, "Queso");
  assert.equal(recents[0].lastUsedAt, "2026-03-05");
  assert.deepEqual(await ctx.get(user, "/recent-foods/recipes?mealIndex=0"), []);
});

test("pegar una comida con receta crea copias independientes (ids nuevos) de la receta y de sus ingredientes", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM });
  const date = "2026-03-10";
  await recipeInMeal(user, date, 2);
  let day = await readDay(user, date);
  const original = day.meals[2].customRecipes[0];
  await editRecipeInMeal(user, day.meals[2]._id, original, { addedCustomProducts: [ingredient(foods.queso, 30)] });
  day = await readDay(user, date);

  await ctx.put(user, `/meals/${day.meals[4]._id}/paste`, { mealClipboard: day.meals[2], merge: true });
  day = await readDay(user, date);
  const copy = day.meals[4].customRecipes[0];
  assert.notEqual(String(copy._id), String(original._id));
  assert.notEqual(String(copy.addedCustomProducts[0]._id), String(day.meals[2].customRecipes[0].addedCustomProducts[0]._id));
  assert.equal(copy.addedCustomProducts[0].quantity, 30);

  await editRecipeInMeal(user, day.meals[4]._id, copy, { quantity: 999 });
  assert.equal((await readDay(user, date)).meals[2].customRecipes[0].quantity, 150, "el original no cambia");
});

test("borrar un producto usado como ingrediente añadido a una receta del diario lo deja como adición rápida", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM });
  const own = await ctx.post(user, "/products", { name: "Salsa propia", userId: user.id, energyKcal100g: 120 });
  await recipeInMeal(user, "2026-03-15", 1, "Pasta");
  const meal = (await readDay(user, "2026-03-15")).meals[1];
  await editRecipeInMeal(user, meal._id, meal.customRecipes[0], { addedCustomProducts: [{ product: String(own._id), quantity: 25 }] });

  assert.equal((await ctx.call(user, "DELETE", `/products/${own._id}`)).status, 204);
  const added = (await readDay(user, "2026-03-15")).meals[1].customRecipes[0].addedCustomProducts[0];
  assert.equal(added.quickAdd, true);
  assert.equal(added.name, "Salsa propia");
  assert.equal(added.energyKcal100g, 120);
  assert.equal(added.quantity, 25);
});

test("comidas guardadas del entrenador: se crean con su contenido, se listan pobladas, se renombran y se borran", async () => {
  const trainer = await ctx.makeTrainer();
  const other = await ctx.makeTrainer();
  const recipe = await ctx.model("Recipe").create({ name: "Bowl", verified: true, customProducts: [{ product: foods.tomate._id, quantity: 100 }] });
  const snippet = await ctx.post(trainer, "/trainer/meal-snippets", {
    name: "Desayuno tipo",
    customProducts: [{ product: String(foods.queso._id), quantity: 30, assignedByTrainerId: other.id, consumed: true }],
    customRecipes: [{ recipe: String(recipe._id), quantity: 200 }],
  });
  assert.equal(snippet.name, "Desayuno tipo");
  assert.equal(snippet.customProducts[0].product.name, "Queso");
  assert.equal(snippet.customProducts[0].assignedByTrainerId, null, "un snippet no nace pautado");
  assert.equal(snippet.customRecipes[0].recipe.name, "Bowl");

  const listed = await ctx.get(trainer, "/trainer/meal-snippets");
  assert.deepEqual(listed.map((item) => item.name), ["Desayuno tipo"]);
  assert.deepEqual(await ctx.get(other, "/trainer/meal-snippets"), []);

  assert.equal((await ctx.put(trainer, `/trainer/meal-snippets/${snippet._id}`, { name: "Desayuno A" })).name, "Desayuno A");
  assert.equal((await ctx.call(other, "DELETE", `/trainer/meal-snippets/${snippet._id}`)).status, 404);
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/meal-snippets/${snippet._id}`)).status, 204);
  assert.equal(await ctx.count("MealSnippet", { trainerId: trainer._id }), 0);
});

test("concurrencia: muchos alimentos añadidos a la vez a la misma comida no se pisan", async () => {
  const user = await ctx.makeClient();
  const date = "2026-03-20";
  await readDay(user, date);
  const names = Array.from({ length: 8 }, (_, i) => `Alimento ${i}`);
  const results = await Promise.all(
    names.map((name) =>
      ctx.call(user, "POST", `/dietdays/date/${date}/meals/0/customproducts`, { customProduct: { quickAdd: true, name, quantity: 10 } }),
    ),
  );
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  const day = await readDay(user, date);
  assert.deepEqual(day.meals[0].customProducts.map((cp) => cp.name).sort(), names.sort());
});
