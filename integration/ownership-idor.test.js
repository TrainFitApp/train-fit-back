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
  const set = await ctx.model("Set").create({ reps: 5, weight: 140, expectedReps: [5] });
  const ce = await ctx.model("CustomExercise").create({ exercise: exercise._id, sets: [set._id] });
  const workout = await ctx.model("Workout").create({ name: "Pull privado", exercises: [ce._id] });
  const split = await ctx.model("Split").create({ name: "Micro privado", workouts: [workout._id] });
  const table = await ctx.model("Table").create({ name: "Rutina privada", userId: owner._id, splits: [split._id] });

  await ctx.post(owner, "/dietdays/x", { date: "2026-06-10", indexMeal: 0, customProduct: { quantity: 100, product: { name: "Desayuno privado", energyKcal100g: 300 } } });
  const day = (await ctx.post(owner, "/dietdays/date/x", { date: "2026-06-10" })).dietDay;
  const meal = day.meals[0];
  const cp = meal.customProducts[0];

  const recipe = await ctx.model("Recipe").create({ name: "Receta privada", userId: owner._id, customProducts: [] });
  const customRecipe = await ctx.model("CustomRecipe").create({ recipe: recipe._id, quantity: 200 });
  await ctx.model("Meal").updateOne({ _id: day.meals[1]._id }, { $push: { customRecipes: customRecipe._id } });

  return { exercise, set, ce, workout, split, table, day, meal, cp, recipe, customRecipe };
}

const reload = (model, id) => ctx.model(model).findById(id).lean();

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

idor("borrar la rutina de otro usuario pasando mi id en la URL", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "DELETE", `/tables/${attacker.id}/${data.table._id}`);
  assert.ok(await reload("Table", data.table._id), "la rutina sigue");
  assert.ok(await reload("Set", data.set._id), "y sus series");
});

idor("copiar o duplicar a mi cuenta la rutina privada de otro", async ({ victim, attacker, data }) => {
  const fields = { fields: { premium: { entitled: true, expiresAt: new Date(Date.now() + 86400000) } } };
  const premiumAttacker = await ctx.makeClient(fields);
  await ctx.call(premiumAttacker, "POST", `/tables/copy/${data.table._id}`, { idUser: premiumAttacker.id });
  await ctx.call(premiumAttacker, "POST", `/tables/duplicate/${data.table._id}`, { idUser: premiumAttacker.id });
  assert.equal(await ctx.count("Table", { userId: premiumAttacker._id }), 0);
});

idor("buscar rutinas de otro usuario pasando su idUser", async ({ victim, attacker, data }) => {
  const found = await ctx.post(attacker, "/tables/search", { search: "", isOwn: true, idUser: victim.id });
  assert.ok(!JSON.stringify(found).includes("Rutina privada"));
});

idor("leer la rutina, el entreno, el ejercicio o la serie de otro por id", async ({ victim, attacker, data }) => {
  for (const path of [`/tables/${data.table._id}`, `/workouts/${data.workout._id}`, `/customexercises/${data.ce._id}`, `/sets/${data.set._id}`]) {
    assert.equal((await ctx.call(attacker, "GET", path)).status, 403, path);
  }
});

idor("editar la serie, el ejercicio o el entreno de otro", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", "/sets", { _id: data.set._id, reps: 1 })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", `/customexercises/${data.ce._id}/client-notes`, { clientNotes: "x" })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", "/workouts/modify/one/simple/save", { _id: data.workout._id, name: "x" })).status, 403);
  assert.equal((await ctx.call(attacker, "DELETE", `/workouts/${data.workout._id}`)).status, 403);
  assert.equal((await ctx.call(attacker, "DELETE", `/sets/${data.set._id}`)).status, 403);
  assert.equal((await reload("Set", data.set._id)).reps, 5);
  assert.equal((await reload("Workout", data.workout._id)).name, "Pull privado");
});

idor("marcar como terminado o como descanso el entreno de otro", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "PUT", "/workouts/finish", { workoutId: data.workout._id, date: "2020-01-01" });
  await ctx.call(attacker, "PUT", "/workouts/skip", { workoutId: data.workout._id, rest: true });
  const stored = await reload("Workout", data.workout._id);
  assert.equal(stored.date ?? null, null);
  assert.equal(stored.rest ?? null, null);
});

idor("renombrar el entreno de otro desde una rutina mía", async ({ victim, attacker, data }) => {
  const mine = await ctx.model("Table").create({ name: "Mía", userId: attacker._id, splits: [] });
  await ctx.call(attacker, "PUT", `/workouts/names/${mine._id}/${data.workout._id}`, { workoutsName: "Hackeado" });
  assert.equal((await reload("Workout", data.workout._id)).name, "Pull privado");
});

idor("enganchar el microciclo de otro a una rutina mía", async ({ victim, attacker, data }) => {
  const mine = await ctx.model("Table").create({ name: "Mía 2", userId: attacker._id, splits: [] });
  await ctx.call(attacker, "PUT", `/splits/split/${mine._id}/${data.split._id}`);
  assert.deepEqual((await reload("Table", mine._id)).splits, []);
});

// Los listados globales (find({}) paginado, sin filtro de dueño) quedan solo
// para admin: ninguna app los usa con un usuario normal.
idor("listar entrenos y microciclos de todos los usuarios", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "GET", "/workouts?limit=100")).status, 403);
  assert.equal((await ctx.call(attacker, "GET", "/splits?limit=100")).status, 403);
  const admin = await ctx.makeAdmin();
  assert.equal((await ctx.call(admin, "GET", "/workouts?limit=1")).status, 200);
});

// --- Nutrición ----------------------------------------------------------------------

idor("listar días de dieta o comidas de todos los usuarios", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "GET", "/dietdays?limit=100")).status, 403);
  assert.equal((await ctx.call(attacker, "GET", "/meals?limit=100")).status, 403);
  const admin = await ctx.makeAdmin();
  assert.equal((await ctx.call(admin, "GET", "/dietdays?limit=1")).status, 200);
});

idor("borrar el día de dieta de otro", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "DELETE", `/dietdays/${attacker.id}/${data.day._id}`);
  assert.ok(await reload("DietDay", data.day._id));
});

idor("meter una comida mía en el día de otro", async ({ victim, attacker, data }) => {
  const myDay = (await ctx.post(attacker, "/dietdays/date/x", { date: "2026-06-11" })).dietDay;
  await ctx.call(attacker, "PUT", `/dietdays/${data.day._id}/${myDay.meals[0]._id}`);
  assert.equal((await reload("DietDay", data.day._id)).meals.length, 6);
});

idor("leer, añadir o quitar alimentos de una comida ajena por las rutas de /meals", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "GET", `/meals/${data.meal._id}`)).status, 400);
  assert.equal((await ctx.call(attacker, "DELETE", `/meals/${data.meal._id}/${data.cp._id}`)).status, 400);
  assert.equal((await ctx.call(attacker, "PATCH", `/meals/${data.meal._id}/completed`, { completed: true })).status, 400);
  assert.equal((await ctx.call(attacker, "PATCH", `/meals/${data.meal._id}/customproducts/${data.cp._id}/quantity`, { quantity: 1 })).status, 400);
  assert.equal((await ctx.call(attacker, "PUT", "/meals/paste", { meals: { mealClipboard: {}, mealToPaste: { _id: data.meal._id } }, merge: false })).status, 400);
  assert.equal((await reload("CustomProduct", data.cp._id)).quantity, 100);
});

idor("modificar una comida ajena por la vía genérica", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "PUT", "/meals/modify/one/simple", { _id: data.meal._id, name: "Hackeada", customProducts: [] });
  const stored = await reload("Meal", data.meal._id);
  assert.equal(stored.name, "Desayuno");
  assert.equal(stored.customProducts.length, 1);
});

idor("leer, editar, borrar o crear alimentos en una comida ajena por /customproducts", async ({ victim, attacker, data }) => {
  const read = await ctx.call(attacker, "GET", `/customproducts/${data.cp._id}`);
  assert.ok(read.status >= 400 || !read.body, "no se lee");
  await ctx.call(attacker, "PUT", "/customproducts", { _id: data.cp._id, quantity: 1 });
  await ctx.call(attacker, "POST", "/customproducts", { idMeal: data.meal._id, customProduct: { quantity: 1, name: "Intruso" }, idUser: attacker.id });
  await ctx.call(attacker, "DELETE", `/customproducts/${data.cp._id}`);
  const meal = await reload("Meal", data.meal._id);
  assert.equal(meal.customProducts.length, 1);
  assert.equal((await reload("CustomProduct", data.cp._id))?.quantity, 100);
});

idor("leer, editar o borrar la receta-instancia (CustomRecipe) de otro", async ({ victim, attacker, data }) => {
  const read = await ctx.call(attacker, "GET", `/customrecipes/${data.customRecipe._id}`);
  assert.ok(read.status >= 400, "no se lee");
  await ctx.call(attacker, "PUT", `/customrecipes/${data.customRecipe._id}`, { quantity: 1 });
  await ctx.call(attacker, "DELETE", `/customrecipes/${data.customRecipe._id}`);
  assert.equal((await reload("CustomRecipe", data.customRecipe._id))?.quantity, 200);
});

idor("enganchar una receta a la comida de otro con /recipes/compose", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "POST", "/recipes/compose", { recipeId: data.recipe._id, customRecipe: { quantity: 100 }, context: { mealId: data.meal._id } });
  assert.equal((await reload("Meal", data.meal._id)).customRecipes.length, 0);
});

idor("leer una receta privada de otro por id", async ({ victim, attacker, data }) => {
  const res = await ctx.call(attacker, "GET", `/recipes/${data.recipe._id}`);
  assert.ok(res.status >= 400, String(res.status));
});

idor("marcar o desmarcar favoritos de producto en nombre de otro", async ({ victim, attacker, data }) => {
  await ctx.call(attacker, "PUT", "/products/favProduct", { idUser: victim.id, idProduct: String(ctx.oid()) });
  assert.deepEqual((await reload("User", victim.id)).archivedProducts, []);
});

// --- Cuenta y medidas ---------------------------------------------------------------

idor("crear rutina, cambiar dieta activa o favoritos de otro usuario por /users", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", `/users/addtable/${victim.id}/${data.table._id}`)).status, 403);
  assert.equal((await ctx.call(attacker, "PATCH", `/users/playstopdiet/${victim.id}`, { enabled: false })).status, 403);
  assert.equal((await ctx.call(attacker, "PUT", "/users/favRecipe", { idUser: victim.id, idRecipe: String(ctx.oid()) })).status, 403);
});

idor("poner en uso en mi cuenta la rutina de otro, o leer su producto privado por código de barras", async ({ victim, attacker, data }) => {
  assert.equal((await ctx.call(attacker, "PUT", `/users/addtable/${attacker.id}/${data.table._id}`)).status, 404);
  assert.equal((await reload("User", attacker.id)).tableInUse ?? null, null);
  await ctx.model("Product").create({ name: "Barritas privadas", code: "8400000000017", userId: victim._id });
  const res = await ctx.get(attacker, `/products/code/${victim.id}/8400000000017`);
  assert.ok(!JSON.stringify(res).includes("Barritas privadas"));
});

idor("ver el día de dieta de otro pasando su id como dietId", async ({ victim, attacker, data }) => {
  const res = await ctx.post(attacker, `/dietdays/date/${victim.id}`, { date: "2026-06-10" });
  assert.notEqual(String(res.dietDay.userId), victim.id, "el dueño sale del token");
  assert.equal(res.dietDay.meals[0].customProducts.length, 0);
});
