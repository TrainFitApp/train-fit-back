const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Copiar y pegar en el diario del cliente cuando hay cosas pautadas por su
// profesional, en el origen, en el destino o en los dos. Dos reglas:
//
//   - Lo pegado es siempre del cliente: sin marca de pautado, sin cantidad
//     pautada y sin "tomado", aunque se copiara de algo pautado.
//   - Lo pautado del destino nunca se lo lleva un pegado del cliente:
//     combinar lo deja todo, reemplazar solo sustituye lo suyo. Solo una
//     comida pautada entera (Meal.assignedByTrainerId) no admite pegar.
//
// El portapapeles se manda como lo manda la app: la comida tal cual la leyó
// (o filtrada a lo seleccionado, siempre combinando) o el día entero.

const ctx = h.setup();

let foods;
ctx.before(async () => {
  const Product = ctx.model("Product");
  foods = {
    pollo: await Product.create({ name: "Pollo", energyKcal100g: 165, protein100g: 31, carbohydrates100g: 0, fat100g: 3.6, verified: true }),
    arroz: await Product.create({ name: "Arroz", energyKcal100g: 130, protein100g: 2.7, carbohydrates100g: 28, fat100g: 0.3, verified: true }),
    avena: await Product.create({ name: "Avena", energyKcal100g: 370, protein100g: 13, carbohydrates100g: 60, fat100g: 7, verified: true }),
    salmon: await Product.create({ name: "Salmón", energyKcal100g: 208, protein100g: 20, carbohydrates100g: 0, fat100g: 13, verified: true }),
    tomate: await Product.create({ name: "Tomate", energyKcal100g: 18, protein100g: 0.9, verified: true }),
  };
});

const SLOT = { desayuno: 0, almuerzo: 1, comida: 2, merienda: 3, cena: 4, recena: 5 };
const cp = (product, quantity) => ({ product: String(product._id), quantity });
const readDay = async (user, date) => (await ctx.post(user, `/dietdays/date/${date}`, {})).dietDay;
const readFull = async (user, date) => ctx.post(user, `/dietdays/date/${date}`, {});
const names = (meal) => [
  ...(meal.customProducts || []).map((item) => item.product?.name || item.name),
  ...(meal.customRecipes || []).map((item) => `receta:${item.recipe?.name}`),
].sort();
const planned = (meal) => names({
  customProducts: meal.customProducts.filter((item) => item.assignedByTrainerId),
  customRecipes: meal.customRecipes.filter((item) => item.assignedByTrainerId),
});
const own = (meal) => names({
  customProducts: meal.customProducts.filter((item) => !item.assignedByTrainerId),
  customRecipes: meal.customRecipes.filter((item) => !item.assignedByTrainerId),
});
const paste = (user, meal, mealClipboard, merge) => ctx.put(user, `/meals/${meal._id}/paste`, { mealClipboard, merge });
const addOwn = (user, date, slot, name, quantity = 50) =>
  ctx.post(user, `/dietdays/date/${date}/meals/${slot}/customproducts`, {
    customProduct: { quantity, product: { name, energyKcal100g: 100, protein100g: 5, carbohydrates100g: 10, fat100g: 2 } },
  });

async function setupPair() {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  const recipe = await ctx.model("Recipe").create({
    name: "Ensalada",
    userId: trainer._id,
    customProducts: [{ product: foods.tomate._id, quantity: 200 }],
  });
  return { trainer, client, recipe };
}

// Lo que pauta el profesional en una comida suelta (F12), por la ruta real:
// combinando (alimentos pautados sueltos, la comida sigue siendo mixta) o
// reemplazando (la comida entera queda pautada).
async function prescribe({ trainer, client, recipe }, date, slot, { merge = true, products, recipes } = {}) {
  const day = await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${date}`);
  return ctx.post(trainer, `/trainer/clients/${client.id}/diet-days/${date}/meals/${day.meals[slot]._id}/prescribe`, {
    customProducts: products || [cp(foods.pollo, 150), cp(foods.arroz, 80)],
    customRecipes: recipes || [{ recipe: String(recipe._id), quantity: 120 }],
    merge,
  });
}

// Plan de dieta con dos menús; el B tiene dos opciones en la Comida.
async function startPlan(trainer, client) {
  const template = await ctx.post(trainer, "/trainer/diet-templates", {
    name: "Plan",
    menus: [
      {
        name: "Menú A",
        meals: [
          { slot: "Desayuno", alternatives: [{ customProducts: [cp(foods.avena, 60)] }] },
          { slot: "Comida", alternatives: [{ customProducts: [cp(foods.pollo, 200), cp(foods.arroz, 80)] }] },
        ],
      },
      {
        name: "Menú B",
        meals: [
          {
            slot: "Comida",
            alternatives: [
              { label: "Pollo", customProducts: [cp(foods.pollo, 180)] },
              { label: "Salmón", customProducts: [cp(foods.salmon, 150)] },
            ],
          },
        ],
      },
    ],
  });
  await ctx.post(trainer, `/trainer/clients/${client.id}/diet-phases`, { templateId: template._id, startDate: h.day(0) });
}

function assertOwnCopy(item) {
  assert.equal(item.assignedByTrainerId ?? null, null, "la copia no está pautada");
  assert.equal(item.assignedQuantity ?? null, null, "ni guarda cantidad pautada");
  assert.equal(item.consumed, false, "ni hereda el tomado");
}

// --- El origen tiene pautados --------------------------------------------------------

test("copiar una comida con pautados y pegarla en una comida vacía: todo llega como propio y el original no cambia", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-02";
  await prescribe(pair, date, SLOT.comida);
  await addOwn(client, date, SLOT.comida, "Pan propio");
  let source = (await readDay(client, date)).meals[SLOT.comida];
  // El cliente ya lo va siguiendo: tomado y con otra cantidad.
  const pollo = source.customProducts.find((item) => item.product.name === "Pollo");
  await ctx.patch(client, `/meals/${source._id}/customproducts/${pollo._id}/consumed`, { consumed: true });
  await ctx.patch(client, `/meals/${source._id}/customproducts/${pollo._id}/quantity`, { quantity: 120 });
  await ctx.patch(client, `/meals/${source._id}/customrecipes/${source.customRecipes[0]._id}/consumed`, { consumed: true });
  source = (await readDay(client, date)).meals[SLOT.comida];

  const target = (await readDay(client, date)).meals[SLOT.cena];
  const pasted = await paste(client, target, source, false);

  assert.deepEqual(names(pasted), ["Arroz", "Pan propio", "Pollo", "receta:Ensalada"]);
  for (const item of [...pasted.customProducts, ...pasted.customRecipes]) assertOwnCopy(item);
  assert.equal(pasted.customProducts.find((item) => item.product.name === "Pollo").quantity, 120, "lo que de verdad comió");
  assert.equal(pasted.customRecipes[0].quantity, 120);
  assert.equal(pasted.assignedByTrainerId ?? null, null);

  // Son suyas de verdad: las puede editar y borrar.
  const copy = pasted.customProducts.find((item) => item.product.name === "Pollo");
  assert.equal((await ctx.call(client, "PUT", `/meals/${target._id}/customproducts/${copy._id}`, { quantity: 10 })).status, 200);
  assert.equal((await ctx.call(client, "DELETE", `/meals/${target._id}/customrecipes/${pasted.customRecipes[0]._id}`)).status, 200);

  // El original sigue pautado, tomado y con sus ids.
  const after = (await readDay(client, date)).meals[SLOT.comida];
  assert.deepEqual(planned(after), ["Arroz", "Pollo", "receta:Ensalada"]);
  const polloAfter = after.customProducts.find((item) => String(item._id) === String(pollo._id));
  assert.equal(polloAfter.consumed, true);
  assert.equal(polloAfter.assignedQuantity, 150);
  assert.equal(after.customRecipes[0].consumed, true);
});

test("copiar lo pautado no cambia la meta del día: lo pegado no cuenta como pautado", async () => {
  const pair = await setupPair();
  const date = "2026-11-03";
  await prescribe(pair, date, SLOT.comida);
  const before = await readFull(pair.client, date);
  await paste(pair.client, before.dietDay.meals[SLOT.merienda], before.dietDay.meals[SLOT.comida], false);
  const after = await readFull(pair.client, date);
  assert.deepEqual(after.plannedTarget, before.plannedTarget);
});

test("selección parcial (lo pautado y lo propio que se marquen) se suma a lo que ya había", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-04";
  await prescribe(pair, date, SLOT.comida);
  await addOwn(client, date, SLOT.comida, "Pan propio");
  await addOwn(client, date, SLOT.cena, "Yogur");
  const day = await readDay(client, date);
  const source = day.meals[SLOT.comida];
  // Lo que manda la app (MealClipboard#getFilteredMeal): la comida con solo
  // lo seleccionado, siempre combinando.
  const selection = {
    _id: source._id,
    name: source.name,
    customProducts: source.customProducts.filter((item) => ["Pollo", "Pan propio"].includes(item.product.name)),
    customRecipes: source.customRecipes,
  };

  const pasted = await paste(client, day.meals[SLOT.cena], selection, true);
  assert.deepEqual(names(pasted), ["Pan propio", "Pollo", "Yogur", "receta:Ensalada"]);
  for (const item of [...pasted.customProducts, ...pasted.customRecipes]) assertOwnCopy(item);
});

test("pegar dos veces lo mismo crea copias con ids distintos", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-05";
  await prescribe(pair, date, SLOT.comida);
  let day = await readDay(client, date);
  const source = day.meals[SLOT.comida];
  await paste(client, day.meals[SLOT.cena], source, true);
  const twice = await paste(client, day.meals[SLOT.cena], source, true);

  const ids = [...twice.customProducts, ...twice.customRecipes].map((item) => String(item._id));
  assert.equal(new Set(ids).size, ids.length);
  const sourceIds = [...source.customProducts, ...source.customRecipes].map((item) => String(item._id));
  assert.ok(ids.every((id) => !sourceIds.includes(id)), "ningún id del original");
  day = await readDay(client, date);
  assert.equal(day.meals[SLOT.cena].customProducts.length, 4);
  assert.equal(day.meals[SLOT.cena].customRecipes.length, 2);
});

test("copiar una comida con opciones de menú: llega la opción elegida como propia, sin las opciones", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  await startPlan(trainer, client);
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú B" });
  let day = await readDay(client, date);
  await ctx.put(client, `/meals/${day.meals[SLOT.comida]._id}/alternative`, { chosenIndex: 1 });
  day = await readDay(client, date);
  const source = day.meals[SLOT.comida];
  assert.equal(source.alternatives.length, 2);

  const pasted = await paste(client, day.meals[SLOT.cena], source, false);
  assert.deepEqual(names(pasted), ["Salmón"]);
  for (const item of pasted.customProducts) assertOwnCopy(item);
  assert.equal(pasted.alternatives.length, 0, "las opciones son del hueco de origen");
  assert.equal(pasted.chosenAlternativeIndex ?? null, null);
});

// --- El destino tiene pautados -------------------------------------------------------

test("pegar combinando en una comida con pautados: lo pautado sigue intacto y lo pegado es propio", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-06";
  await prescribe(pair, date, SLOT.comida);
  await prescribe(pair, date, SLOT.cena, { products: [cp(foods.salmon, 150)], recipes: [] });
  await addOwn(client, date, SLOT.cena, "Pan propio");
  const day = await readDay(client, date);
  const target = day.meals[SLOT.cena];
  const salmon = target.customProducts.find((item) => item.product.name === "Salmón");
  await ctx.patch(client, `/meals/${target._id}/customproducts/${salmon._id}/consumed`, { consumed: true });

  const pasted = await paste(client, target, day.meals[SLOT.comida], true);
  assert.deepEqual(planned(pasted), ["Salmón"]);
  assert.deepEqual(own(pasted), ["Arroz", "Pan propio", "Pollo", "receta:Ensalada"]);
  const salmonAfter = pasted.customProducts.find((item) => String(item._id) === String(salmon._id));
  assert.equal(salmonAfter.consumed, true, "mismo alimento pautado, con su tomado");
  assert.equal(salmonAfter.assignedQuantity, 150);
});

test("pegar reemplazando en una comida con pautados: se sustituye solo lo propio y lo pautado se queda", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-07";
  await prescribe(pair, date, SLOT.comida);
  await prescribe(pair, date, SLOT.cena, { products: [cp(foods.salmon, 150)], recipes: [] });
  await addOwn(client, date, SLOT.cena, "Pan propio");
  const day = await readDay(client, date);
  const target = day.meals[SLOT.cena];
  const salmonId = target.customProducts.find((item) => item.product.name === "Salmón")._id;
  const panId = target.customProducts.find((item) => item.product.name === "Pan propio")._id;

  const res = await ctx.call(client, "PUT", `/meals/${target._id}/paste`, { mealClipboard: day.meals[SLOT.comida], merge: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(planned(res.body), ["Salmón"]);
  assert.deepEqual(own(res.body), ["Arroz", "Pollo", "receta:Ensalada"]);
  assert.ok(await ctx.findDiaryItem(salmonId), "el pautado es el mismo");
  assert.equal(await ctx.findDiaryItem(panId), null, "lo propio reemplazado se borra");
});

test("pegar en una comida que el profesional pautó entera: 403 MEAL_PROTECTED en los dos modos y no cambia nada", async () => {
  const pair = await setupPair();
  const { client } = pair;
  const date = "2026-11-09";
  await addOwn(client, date, SLOT.desayuno, "Tostada");
  await prescribe(pair, date, SLOT.cena, { merge: false });
  const day = await readDay(client, date);
  const locked = day.meals[SLOT.cena];
  assert.ok(locked.assignedByTrainerId);

  for (const merge of [true, false]) {
    const res = await ctx.call(client, "PUT", `/meals/${locked._id}/paste`, { mealClipboard: day.meals[SLOT.desayuno], merge });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "MEAL_PROTECTED");
  }
  const stored = await ctx.findMeal(locked._id);
  assert.equal(stored.customProducts.length, 2);
  assert.equal(stored.customRecipes.length, 1);
  // Copiar DESDE ella sí se puede, y lo pegado es propio.
  const pasted = await paste(client, day.meals[SLOT.merienda], locked, false);
  for (const item of [...pasted.customProducts, ...pasted.customRecipes]) assertOwnCopy(item);
});

test("pegar en otro día con plan: lo pautado de ese día se queda y lo pegado se suma como propio", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  await startPlan(trainer, client);
  const today = h.day(0);
  const tomorrow = h.day(1);
  await ctx.put(client, `/dietdays/date/${today}/menu`, { menuName: "Menú A" });
  await ctx.put(client, `/dietdays/date/${tomorrow}/menu`, { menuName: "Menú A" });
  const source = (await readDay(client, today)).meals[SLOT.comida];
  assert.deepEqual(planned(source), ["Arroz", "Pollo"]);

  // Con solo pautados en el destino la app pega sin preguntar (reemplazar).
  const target = (await readDay(client, tomorrow)).meals[SLOT.desayuno];
  assert.deepEqual(planned(target), ["Avena"]);
  const pasted = await paste(client, target, source, false);
  assert.deepEqual(planned(pasted), ["Avena"]);
  assert.deepEqual(own(pasted), ["Arroz", "Pollo"]);
});

test("pegar en una comida con opciones de menú: cambiar de opción después conserva lo pegado", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  await startPlan(trainer, client);
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú B" });
  await addOwn(client, date, SLOT.desayuno, "Tostada");
  const day = await readDay(client, date);
  const comida = day.meals[SLOT.comida];
  assert.equal(comida.alternatives.length, 2);

  await paste(client, comida, day.meals[SLOT.desayuno], false);
  await ctx.put(client, `/meals/${comida._id}/alternative`, { chosenIndex: 1 });
  const after = (await readDay(client, date)).meals[SLOT.comida];
  assert.deepEqual(planned(after), ["Salmón"]);
  assert.deepEqual(own(after), ["Tostada"]);
  assert.equal(after.alternatives.length, 2, "las opciones siguen ahí");
});

// --- Pegar un día entero ---------------------------------------------------------------

test("pegar un día con pautados en un día sin plan: todo llega como propio y el origen no cambia", async () => {
  const pair = await setupPair();
  const { client } = pair;
  await prescribe(pair, "2026-11-10", SLOT.comida);
  await addOwn(client, "2026-11-10", SLOT.desayuno, "Tostada");
  const source = await readDay(client, "2026-11-10");

  const pasted = await ctx.put(client, "/dietdays/date/2026-11-11/paste", { dietDayClipboard: source });
  assert.deepEqual(names(pasted.meals[SLOT.desayuno]), ["Tostada"]);
  assert.deepEqual(names(pasted.meals[SLOT.comida]), ["Arroz", "Pollo", "receta:Ensalada"]);
  for (const meal of pasted.meals) {
    for (const item of [...meal.customProducts, ...meal.customRecipes]) assertOwnCopy(item);
  }
  const original = await readDay(client, "2026-11-10");
  assert.deepEqual(planned(original.meals[SLOT.comida]), ["Arroz", "Pollo", "receta:Ensalada"]);
});

test("pegar un día sobre un día con plan: lo pautado, el menú y las opciones se quedan; lo propio se sustituye", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  await startPlan(trainer, client);
  const source = h.day(1);
  const target = h.day(2);
  await ctx.put(client, `/dietdays/date/${source}/menu`, { menuName: "Menú A" });
  await addOwn(client, source, SLOT.cena, "Tortilla");
  await ctx.put(client, `/dietdays/date/${target}/menu`, { menuName: "Menú B" });
  await addOwn(client, target, SLOT.comida, "Pan viejo");
  const before = await readDay(client, target);
  const plannedIds = before.meals[SLOT.comida].customProducts.filter((item) => item.assignedByTrainerId).map((item) => String(item._id));

  const res = await ctx.call(client, "PUT", `/dietdays/date/${target}/paste`, { dietDayClipboard: await readDay(client, source) });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await readDay(client, target);
  assert.equal(after.menuName, "Menú B");
  assert.deepEqual(after.meals.map((meal) => meal._id), before.meals.map((meal) => meal._id), "mismas comidas");
  const comida = after.meals[SLOT.comida];
  assert.deepEqual(planned(comida), ["Pollo"], "lo pautado del destino (opción 1 del menú B)");
  assert.deepEqual(
    comida.customProducts.filter((item) => item.assignedByTrainerId).map((item) => String(item._id)),
    plannedIds,
  );
  assert.deepEqual(own(comida), ["Arroz", "Pollo"], "lo pautado del origen llega como propio; el pan viejo se va");
  assert.equal(comida.alternatives.length, 2);
  assert.deepEqual(own(after.meals[SLOT.desayuno]), ["Avena"]);
  assert.deepEqual(own(after.meals[SLOT.cena]), ["Tortilla"]);
});

test("pegar un día en una fecha del plan sin día: el plan sigue entrando después", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  await startPlan(trainer, client);
  await addOwn(client, "2026-11-12", SLOT.desayuno, "Tostada");
  const source = await readDay(client, "2026-11-12");
  const date = h.day(3);
  await ctx.put(client, `/dietdays/date/${date}/paste`, { dietDayClipboard: source });
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  const after = await readDay(client, date);
  assert.deepEqual(planned(after.meals[SLOT.desayuno]), ["Avena"]);
  assert.deepEqual(own(after.meals[SLOT.desayuno]), ["Tostada"]);
  assert.equal(await ctx.count("DietDay", { userId: client._id, date }), 1);
});

// --- Lo del profesional no cambia ----------------------------------------------------

test("el profesional al pautar reemplazando sí rehace su pauta: no se acumula lo pautado anterior", async () => {
  const pair = await setupPair();
  const date = "2026-11-13";
  await prescribe(pair, date, SLOT.comida, { merge: false });
  await prescribe(pair, date, SLOT.comida, { merge: false, products: [cp(foods.salmon, 100)], recipes: [] });
  const meal = (await readDay(pair.client, date)).meals[SLOT.comida];
  assert.deepEqual(names(meal), ["Salmón"]);
});

test("pegar es del cliente: el profesional no usa la ruta del diario y nadie pega en una comida ajena", async () => {
  const pair = await setupPair();
  const { trainer, client } = pair;
  const day = await readDay(client, "2026-11-14");
  const res = await ctx.call(trainer, "PUT", `/meals/${day.meals[0]._id}/paste`, { mealClipboard: day.meals[1], merge: true });
  assert.equal(res.status, 403);
  const stranger = await ctx.makeClient();
  const other = await ctx.call(stranger, "PUT", `/meals/${day.meals[0]._id}/paste`, { mealClipboard: day.meals[1], merge: true });
  assert.equal(other.status, 400);
  assert.equal(other.body.code, "MEAL_NOT_FOUND");
  const dayRes = await ctx.call(trainer, "PUT", "/dietdays/date/2026-11-14/paste", { dietDayClipboard: day });
  assert.equal(dayRes.status, 403);
});
