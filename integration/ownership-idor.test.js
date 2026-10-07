const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Matriz de propiedad (IDOR): un usuario autenticado usa ids de OTRO usuario
// en cada endpoint que los acepta. Ninguna de estas peticiones puede leer ni
// cambiar nada de la víctima. Los casos que hoy fallan están marcados como
// `todo` con el hueco concreto: al arreglarlos, el test pasa y hay que
// quitarle la marca.

const ctx = h.setup();


async function seedVictim(owner) {
  const exercise = await ctx.model("Exercise").create({ name: "Peso muerto" });
  const { table, workouts } = await ctx.seedTable({
    owner,
    name: "Rutina privada",
    splits: [
      {
        name: "Micro privado",
        workouts: [{ name: "Pull privado", exercises: [{ exercise: exercise._id, sets: [{ reps: 5, weight: 140, expectedReps: [5] }] }] }],
      },
    ],
  });
  const workout = workouts[0];
  const ce = workout.exercises[0];
  const set = ce.sets[0];
  const split = table.splits[0];

  await ctx.post(owner, `/dietdays/date/2026-06-10/meals/0/customproducts`, { customProduct: { quantity: 100, product: { name: "Desayuno privado", energyKcal100g: 300 } } });
  const day = (await ctx.post(owner, `/dietdays/date/2026-06-10`, {})).dietDay;
  const meal = day.meals[0];
  const cp = meal.customProducts[0];

  const recipe = await ctx.model("Recipe").create({ name: "Receta privada", userId: owner._id, customProducts: [] });
  const customRecipe = { _id: ctx.oid(), recipe: recipe._id, quantity: 200 };
  await ctx.model("DietDay").updateOne({ "meals._id": day.meals[1]._id }, { $push: { "meals.$.customRecipes": customRecipe } });

  return { exercise, set, ce, workout, split, table, day, meal, cp, recipe, customRecipe };
}

const EMBEDDED = {
  Set: (id) => ctx.findSet(id),
  Meal: (id) => ctx.findMeal(id),
  CustomProduct: (id) => ctx.findDiaryItem(id, "customProducts"),
  CustomRecipe: (id) => ctx.findDiaryItem(id, "customRecipes"),
};
const reload = (model, id) => (EMBEDDED[model] ? EMBEDDED[model](id) : ctx.model(model).findById(id).lean());

// Cada caso con su propia víctima: varios de estos huecos BORRAN datos y no
// pueden contaminar el caso siguiente.
function idor(name, fn, todo) {
  test(name, todo ? { todo: `IDOR: ${todo}` } : {}, async () => {
    const victim = await ctx.makeClient({ name: "Victima" });
    const attacker = await ctx.makeClient({ name: "Atacante" });
    const data = await seedVictim(victim);
    await fn({ victim, attacker, data });
  });
}

// --- Entrenamiento ----------------------------------------------------------------

idor("borrar la rutina de otro usuario", async ({ attacker, data }) => {
  await ctx.call(attacker, "DELETE", `/tables/${data.table._id}`);
  assert.ok(await reload("Table", data.table._id), "la rutina sigue");
  assert.ok(await reload("Set", data.set._id), "y sus series");
});

idor("copiar o duplicar a mi cuenta la rutina privada de otro", async ({ data }) => {
  const fields = { fields: { premium: { entitled: true, expiresAt: new Date(Date.now() + 86400000) } } };
  const premiumAttacker = await ctx.makeClient(fields);
  await ctx.call(premiumAttacker, "POST", `/tables/copy/${data.table._id}`, { idUser: premiumAttacker.id });
  await ctx.call(premiumAttacker, "POST", `/tables/duplicate/${data.table._id}`, { idUser: premiumAttacker.id });
  assert.equal(await ctx.count("Table", { userId: premiumAttacker._id }), 0);
});

idor("buscar rutinas de otro usuario pasando su idUser", async ({ victim, attacker }) => {
  const found = await ctx.post(attacker, "/tables/search", { search: "", isOwn: true, idUser: victim.id });
  assert.ok(!JSON.stringify(found).includes("Rutina privada"));
});

idor("leer la rutina, el entreno o el ejercicio de otro por id", async ({ attacker, data }) => {
  for (const path of [`/tables/${data.table._id}`, `/workouts/${data.workout._id}`, `/customexercises/${data.ce._id}`]) {
    assert.equal((await ctx.call(attacker, "GET", path)).status, 403, path);
  }
});

idor("editar la serie, el ejercicio o el entreno de otro", async ({ attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", "/sets", { _id: data.set._id, reps: 1 })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", `/customexercises/${data.ce._id}/client-notes`, { clientNotes: "x" })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", "/workouts/modify/one/simple/save", { _id: data.workout._id, name: "x" })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", "/workouts/deletes", [{ _id: data.workout._id }])).status, 403);
  assert.equal((await ctx.call(attacker, "DELETE", `/sets/${data.set._id}`)).status, 403);
  assert.equal((await reload("Set", data.set._id)).reps, 5);
  assert.equal((await reload("Workout", data.workout._id)).name, "Pull privado");
});

idor("marcar como terminado o como descanso el entreno de otro", async ({ attacker, data }) => {
  await ctx.call(attacker, "PUT", "/workouts/finish", { workoutId: data.workout._id, date: "2020-01-01" });
  await ctx.call(attacker, "PUT", "/workouts/skip", { workoutId: data.workout._id, rest: true });
  const stored = await reload("Workout", data.workout._id);
  assert.equal(stored.date ?? null, null);
  assert.equal(stored.rest ?? null, null);
});

idor("renombrar el entreno de otro desde una rutina mía", async ({ attacker, data }) => {
  const mine = await ctx.model("Table").create({ name: "Mía", userId: attacker._id, splits: [] });
  await ctx.call(attacker, "PUT", `/workouts/names/${mine._id}/${data.workout._id}`, { workoutsName: "Hackeado" });
  assert.equal((await reload("Workout", data.workout._id)).name, "Pull privado");
});

// Desde 2026-10 un microciclo solo existe dentro de su rutina: no hay ruta
// para "enganchar" uno de otra (antes: PUT /splits/split/:idTable/:idSplit).
idor("enganchar el microciclo de otro a una rutina mía", async ({ attacker, data }) => {
  const mine = await ctx.model("Table").create({ name: "Mía 2", userId: attacker._id, splits: [] });
  assert.equal((await ctx.call(attacker, "PUT", `/splits/split/${mine._id}/${data.split._id}`)).status, 404);
  assert.deepEqual((await reload("Table", mine._id)).splits, []);
});

// --- Nutrición ----------------------------------------------------------------------

idor("borrar el día de dieta de otro: por fecha solo se borra el propio", async ({ attacker, data }) => {
  await ctx.call(attacker, "DELETE", `/dietdays/date/${data.day.date}`);
  assert.ok(await reload("DietDay", data.day._id));
});

idor("leer, añadir o quitar alimentos de una comida ajena por las rutas de /meals", async ({ attacker, data }) => {
  assert.equal((await ctx.call(attacker, "GET", `/meals/${data.meal._id}`)).status, 400);
  assert.equal((await ctx.call(attacker, "DELETE", `/meals/${data.meal._id}/customproducts/${data.cp._id}`)).status, 400);
  assert.equal((await ctx.call(attacker, "PATCH", `/meals/${data.meal._id}/customproducts/${data.cp._id}/quantity`, { quantity: 1 })).status, 400);
  assert.equal((await ctx.call(attacker, "PUT", `/meals/${data.meal._id}/paste`, { mealClipboard: {}, merge: false })).status, 400);
  assert.equal((await ctx.call(attacker, "PUT", `/meals/${data.meal._id}/customproducts/${data.cp._id}`, { quantity: 1 })).status, 400);
  assert.equal((await ctx.call(attacker, "POST", `/meals/${data.meal._id}/customproducts`, { customProduct: { quantity: 1, name: "Intruso" } })).status, 400);
  assert.equal((await reload("CustomProduct", data.cp._id)).quantity, 100);
  assert.equal((await reload("Meal", data.meal._id)).customProducts.length, 1);
});

idor("modificar una comida ajena por la vía genérica", async ({ attacker, data }) => {
  await ctx.call(attacker, "PUT", `/meals/${data.meal._id}`, { name: "Hackeada", customProducts: [] });
  const stored = await reload("Meal", data.meal._id);
  assert.equal(stored.name, "Desayuno");
  assert.equal(stored.customProducts.length, 1);
});

idor("editar o borrar la receta-instancia (CustomRecipe) de otro", async ({ attacker, data }) => {
  const mealId = data.day.meals[1]._id;
  await ctx.call(attacker, "POST", "/recipes/compose", {
    mode: "edit",
    recipeId: data.recipe._id,
    customRecipe: { quantity: 1 },
    context: { mealId, customRecipeId: data.customRecipe._id },
  });
  assert.equal((await ctx.call(attacker, "DELETE", `/meals/${mealId}/customrecipes/${data.customRecipe._id}`)).status, 400);
  assert.equal((await reload("CustomRecipe", data.customRecipe._id))?.quantity, 200);
});

idor("enganchar una receta a la comida de otro con /recipes/compose", async ({ attacker, data }) => {
  await ctx.call(attacker, "POST", "/recipes/compose", { recipeId: data.recipe._id, customRecipe: { quantity: 100 }, context: { mealId: data.meal._id } });
  assert.equal((await reload("Meal", data.meal._id)).customRecipes.length, 0);
});

idor("leer una receta privada de otro por id", async ({ attacker, data }) => {
  const res = await ctx.call(attacker, "GET", `/recipes/${data.recipe._id}`);
  assert.ok(res.status >= 400, String(res.status));
});

idor("marcar favoritos en nombre de otro: siempre son los de la sesión", async ({ victim, attacker }) => {
  const product = await ctx.model("Product").create({ name: "Favorito", verified: true });
  await ctx.call(attacker, "PUT", `/favorites/products/${product._id}`, { idUser: victim.id, userId: victim.id });
  assert.deepEqual((await reload("User", victim.id)).favorites.products, []);
  assert.deepEqual((await reload("User", attacker.id)).favorites.products.map(String), [String(product._id)]);
});

// --- Cuenta y medidas ---------------------------------------------------------------

idor("marcar como favorita una receta privada de otro: 404", async ({ attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", `/favorites/recipes/${data.recipe._id}`)).status, 404);
});

idor("poner en uso en mi cuenta la rutina de otro, o leer su producto privado por código de barras", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", `/users/addtable/${attacker.id}/${data.table._id}`)).status, 404);
  assert.equal((await reload("User", attacker.id)).tableInUse ?? null, null);
  await ctx.model("Product").create({ name: "Barritas privadas", code: "8400000000017", userId: victim._id });
  const res = await ctx.get(attacker, `/products/code/8400000000017`);
  assert.ok(!JSON.stringify(res).includes("Barritas privadas"));
});

idor("ver el día de dieta de otro: por fecha solo se ve el propio", async ({ victim, attacker }) => {
  const res = await ctx.post(attacker, "/dietdays/date/2026-06-10", { userId: victim.id });
  assert.notEqual(String(res.dietDay.userId), victim.id, "el dueño sale del token");
  assert.equal(res.dietDay.meals[0].customProducts.length, 0);
});
