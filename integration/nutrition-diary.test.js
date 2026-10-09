const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Diario de nutrición del cliente: días, comidas y alimentos. Lo importante
// aquí es la COHERENCIA entre pantallas: lo que se escribe por una ruta
// (añadir alimento, peso, nota, pegar día) tiene que verse igual al leer el
// día, el calendario o la semana, y nunca dejar días duplicados ni
// documentos huérfanos detrás.

const ctx = h.setup();
const SLOTS = ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena", "Recena"];

const readDay = async (user, date) => ctx.post(user, `/dietdays/date/${date}`, {});
const mealAt = (day, index) => day.meals[index];

function food(name, { kcal = 100, protein = 10, carbs = 10, fat = 2, quantity = 100 } = {}) {
  return {
    quantity,
    product: { name, energyKcal100g: kcal, protein100g: protein, carbohydrates100g: carbs, fat100g: fat },
  };
}

const addFoodPath = (date, indexMeal) => `/dietdays/date/${date}/meals/${indexMeal}/customproducts`;

async function addFood(user, date, indexMeal, customProduct) {
  return ctx.post(user, addFoodPath(date, indexMeal), { customProduct });
}

// --- Día -------------------------------------------------------------------------

test("leer una fecha la crea con sus 6 comidas estándar y leerla otra vez devuelve el MISMO día", async () => {
  const user = await ctx.makeClient();
  const date = h.day(0);
  const first = await readDay(user, date);
  assert.equal(first.dietDay.date, date);
  assert.deepEqual(first.dietDay.meals.map((m) => m.name), SLOTS);
  assert.equal(first.plannedTarget, null, "sin plan no hay meta pautada");
  assert.equal(first.anthropometry, null);
  assert.equal(first.week, null);

  const second = await readDay(user, date);
  assert.equal(second.dietDay._id, first.dietDay._id);
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 1);
});

test("abrir un día es idempotente por fecha y nunca acepta comidas del cuerpo", async () => {
  const user = await ctx.makeClient();
  const a = (await ctx.post(user, "/dietdays/date/2026-03-10", { meals: [{ name: "Inyectada" }] })).dietDay;
  const b = (await readDay(user, "2026-03-10")).dietDay;
  assert.equal(a._id, b._id);
  assert.deepEqual(a.meals.map((m) => m.name), SLOTS);
});

test("carrera: 10 aperturas simultáneas de la misma fecha dejan UN día con sus 6 comidas", async () => {
  const user = await ctx.makeClient();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => ctx.call(user, "POST", "/dietdays/date/2026-04-01", {})),
  );
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(new Set(results.map((r) => r.body.dietDay._id)).size, 1, "todas reciben el mismo día");
  assert.equal(await ctx.count("DietDay", { userId: user._id, date: "2026-04-01" }), 1);
  const stored = await ctx.model("DietDay").findOne({ userId: user._id, date: "2026-04-01" }).lean();
  assert.equal(stored.meals.length, 6, "las comidas van dentro del único día");
});

test("carrera: añadir alimentos a la vez en una fecha nueva no duplica el día ni pierde alimentos", async () => {
  const user = await ctx.makeClient();
  const date = "2026-04-02";
  const results = await Promise.all([
    ctx.call(user, "POST", addFoodPath(date, 0), { customProduct: food("Pan") }),
    ctx.call(user, "POST", addFoodPath(date, 0), { customProduct: food("Aceite") }),
    ctx.call(user, "POST", addFoodPath(date, 2), { customProduct: food("Arroz") }),
  ]);
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await ctx.count("DietDay", { userId: user._id, date }), 1);
  const day = (await readDay(user, date)).dietDay;
  assert.deepEqual(mealAt(day, 0).customProducts.map((cp) => cp.product.name).sort(), ["Aceite", "Pan"]);
  assert.deepEqual(mealAt(day, 2).customProducts.map((cp) => cp.product.name), ["Arroz"]);
});

test("toda escritura por fecha valida el formato YYYY-MM-DD (400) y no crea nada", async () => {
  const user = await ctx.makeClient();
  const bad = ["2026-4-1", "01-04-2026", "2026-04-01T00:00:00Z", "mañana"];
  for (const date of bad) {
    assert.equal((await ctx.call(user, "POST", `/dietdays/date/${date}`, {})).status, 400, `POST /dietdays/date/${date}`);
    assert.equal((await ctx.call(user, "POST", addFoodPath(date, 0), { customProduct: food("X") })).status, 400);
    assert.equal((await ctx.call(user, "PUT", `/dietdays/date/${date}/notes`, { notes: "x" })).status, 400);
  }
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 0);
  assert.equal(await ctx.count("Product", { userId: user._id }), 0);
});

// --- Alimentos ------------------------------------------------------------------

test("añadir un alimento a una fecha nueva: crea el día, el producto propio y lo pone en su comida", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-05";
  await addFood(user, date, 2, food("Lentejas caseras", { kcal: 116, protein: 9, quantity: 250 }));

  const day = (await readDay(user, date)).dietDay;
  const comida = mealAt(day, 2);
  assert.equal(comida.customProducts.length, 1);
  const cp = comida.customProducts[0];
  assert.equal(cp.quantity, 250);
  assert.equal(cp.product.name, "Lentejas caseras");
  assert.equal(String(cp.product.userId), user.id, "el producto nuevo es del usuario del token");
  assert.equal(cp.mealId, undefined, "el alimento no guarda a qué comida pertenece: va dentro de ella");
  for (const [i, meal] of day.meals.entries()) if (i !== 2) assert.equal(meal.customProducts.length, 0);

  // El producto nuevo ya es buscable (los campos derivados los pone el schema).
  const stored = await ctx.model("Product").findById(cp.product._id).lean();
  assert.ok(stored.searchTokens.includes("lentejas"));
});

test("el dueño del día SIEMPRE sale del token", async () => {
  const victim = await ctx.makeClient();
  const attacker = await ctx.makeClient();
  await ctx.post(attacker, addFoodPath("2026-05-06", 0), { userId: victim.id, customProduct: food("Intruso") });
  assert.equal(await ctx.count("DietDay", { userId: victim._id }), 0);
  assert.equal(await ctx.count("DietDay", { userId: attacker._id }), 1);
});

test("hueco de comida inexistente: 400 y sin producto creado", async () => {
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "POST", addFoodPath("2026-05-07", 9), { customProduct: food("Fantasma") });
  assert.equal(res.status, 400);
  assert.equal(await ctx.count("Product", { userId: user._id }), 0);
});

test("añadir un producto de catálogo existente lo enlaza (no lo duplica)", async () => {
  const global = await ctx.model("Product").create({ name: "Manzana catálogo", energyKcal100g: 52, verified: true });
  const user = await ctx.makeClient();
  await addFood(user, "2026-05-08", 3, { quantity: 180, product: { _id: String(global._id), name: global.name } });
  const day = (await readDay(user, "2026-05-08")).dietDay;
  assert.equal(String(mealAt(day, 3).customProducts[0].product._id), String(global._id));
  assert.equal(await ctx.count("Product", { name: "Manzana catálogo" }), 1);
});

test("añadir un producto pasando solo su id (string) lo enlaza, sin crear un producto basura", async () => {
  const global = await ctx.model("Product").create({ name: "Pera catálogo", energyKcal100g: 57 });
  const user = await ctx.makeClient();
  const before = await ctx.count("Product", {});
  await ctx.call(user, "POST", addFoodPath("2026-05-09", 3), { customProduct: { quantity: 100, product: String(global._id) } });
  assert.equal(await ctx.count("Product", {}), before);
});

test("cambiar la cantidad consumida se ve al releer el día; cantidades inválidas dan 400", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-10";
  await addFood(user, date, 0, food("Avena", { quantity: 50 }));
  let day = (await readDay(user, date)).dietDay;
  const meal = mealAt(day, 0);
  const cp = meal.customProducts[0];

  await ctx.patch(user, `/meals/${meal._id}/customproducts/${cp._id}/quantity`, { quantity: 80 });
  day = (await readDay(user, date)).dietDay;
  assert.equal(mealAt(day, 0).customProducts[0].quantity, 80);

  for (const body of [{ quantity: -1 }, { quantity: "abc" }, {}]) {
    assert.equal((await ctx.call(user, "PATCH", `/meals/${meal._id}/customproducts/${cp._id}/quantity`, body)).status, 400, JSON.stringify(body));
  }
  // 0 sí vale: "no me lo comí".
  await ctx.patch(user, `/meals/${meal._id}/customproducts/${cp._id}/quantity`, { quantity: 0 });
  await ctx.patch(user, `/meals/${meal._id}/customproducts/${cp._id}/quantity`, { quantity: 80 });
  // Un producto que no está en esa comida: 400 (no se fía del id suelto).
  const otherMeal = mealAt(day, 1);
  assert.equal((await ctx.call(user, "PATCH", `/meals/${otherMeal._id}/customproducts/${cp._id}/quantity`, { quantity: 10 })).status, 400);
});

test("quitar un alimento de una comida lo borra de verdad", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-11";
  await addFood(user, date, 1, food("Yogur"));
  await addFood(user, date, 1, food("Nueces"));
  let day = (await readDay(user, date)).dietDay;
  const meal = mealAt(day, 1);
  const yogur = meal.customProducts.find((cp) => cp.product.name === "Yogur");

  await ctx.del(user, `/meals/${meal._id}/customproducts/${yogur._id}`);
  day = (await readDay(user, date)).dietDay;
  assert.deepEqual(mealAt(day, 1).customProducts.map((cp) => cp.product.name), ["Nueces"]);
  assert.equal(await ctx.findDiaryItem(yogur._id), null);
});

test("vaciar los productos de una comida borra solo los del cliente", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-12";
  await addFood(user, date, 4, food("Pescado"));
  await addFood(user, date, 4, food("Patata"));
  let day = (await readDay(user, date)).dietDay;
  const ids = mealAt(day, 4).customProducts.map((cp) => cp._id);
  await ctx.del(user, `/meals/${mealAt(day, 4)._id}/customproducts`);
  day = (await readDay(user, date)).dietDay;
  assert.equal(mealAt(day, 4).customProducts.length, 0);
  for (const id of ids) assert.equal(await ctx.findDiaryItem(id), null);
});

test("marcar un producto consumido se refleja al releer", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-13";
  await addFood(user, date, 0, food("Café"));
  let day = (await readDay(user, date)).dietDay;
  const meal = mealAt(day, 0);
  await ctx.patch(user, `/meals/${meal._id}/customproducts/${meal.customProducts[0]._id}/consumed`, { consumed: true });
  day = (await readDay(user, date)).dietDay;
  assert.equal(mealAt(day, 0).customProducts[0].consumed, true);

  await ctx.patch(user, `/meals/${meal._id}/customproducts/${meal.customProducts[0]._id}/consumed`, { consumed: false });
  day = (await readDay(user, date)).dietDay;
  assert.equal(mealAt(day, 0).customProducts[0].consumed, false);
});

test("editar nombre y notas de una comida", async () => {
  const user = await ctx.makeClient();
  const day = (await readDay(user, "2026-05-14")).dietDay;
  const meal = mealAt(day, 5);
  await ctx.put(user, `/meals/${meal._id}`, { name: "Pre-cama", notes: "  sin azúcar " });
  let stored = await ctx.findMeal(meal._id);
  assert.equal(stored.name, "Pre-cama");
  assert.equal(stored.notes, "sin azúcar");
  await ctx.put(user, `/meals/${meal._id}`, { name: "Pre-cama", notes: "   " });
  stored = await ctx.findMeal(meal._id);
  assert.equal(stored.notes, undefined, "nota en blanco = sin nota");
});

test("pegar una comida: combinar suma, reemplazar sustituye y borra lo anterior; las copias son independientes", async () => {
  const user = await ctx.makeClient();
  const date = "2026-05-15";
  await addFood(user, date, 0, food("Tostada"));
  await addFood(user, date, 1, food("Plátano"));
  let day = (await readDay(user, date)).dietDay;
  const source = mealAt(day, 0);
  const target = mealAt(day, 1);
  const platanoId = target.customProducts[0]._id;

  await ctx.put(user, `/meals/${target._id}/paste`, { mealClipboard: source, merge: true });
  day = (await readDay(user, date)).dietDay;
  assert.deepEqual(mealAt(day, 1).customProducts.map((cp) => cp.product.name).sort(), ["Plátano", "Tostada"]);

  await ctx.put(user, `/meals/${target._id}/paste`, { mealClipboard: source, merge: false });
  day = (await readDay(user, date)).dietDay;
  assert.deepEqual(mealAt(day, 1).customProducts.map((cp) => cp.product.name), ["Tostada"]);
  assert.equal(await ctx.findDiaryItem(platanoId), null, "lo reemplazado se borra");

  // Cambiar la copia no toca el original.
  const copy = mealAt(day, 1).customProducts[0];
  assert.notEqual(copy._id, source.customProducts[0]._id);
  await ctx.patch(user, `/meals/${mealAt(day, 1)._id}/customproducts/${copy._id}/quantity`, { quantity: 999 });
  day = (await readDay(user, date)).dietDay;
  assert.equal(mealAt(day, 0).customProducts[0].quantity, 100);
});

test("pegar en una comida que no es del usuario: 400", async () => {
  const user = await ctx.makeClient();
  assert.equal((await ctx.call(user, "PUT", `/meals/${ctx.oid()}/paste`, { mealClipboard: {} })).status, 400);
});

// --- Nota y peso ----------------------------------------------------------------

test("nota del día: se guarda por fecha (estrena el día), se recorta, en blanco se borra y no acepta comidas del cuerpo", async () => {
  const user = await ctx.makeClient();
  const saved = await ctx.put(user, "/dietdays/date/2026-06-01/notes", { notes: "  Día de fiesta  ", meals: [] });
  assert.equal(saved.notes, "Día de fiesta");
  assert.equal(saved.date, "2026-06-01");
  assert.equal(saved.meals.length, 6, "las comidas del cuerpo se ignoran");
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 1);

  const cleared = await ctx.put(user, "/dietdays/date/2026-06-01/notes", { notes: "   " });
  assert.equal(cleared.notes, undefined);
});

test("nota del día: la fecha de la URL manda sobre una `date` del cuerpo", async () => {
  const user = await ctx.makeClient();
  const saved = await ctx.put(user, "/dietdays/date/2026-06-01/notes", { notes: "x", date: "2026-06-02" });
  assert.equal(saved.date, "2026-06-01");
  assert.equal(await ctx.count("DietDay", { userId: user._id, date: "2026-06-02" }), 0);
});

test("peso del día (Anthropometry): sale al leer el día y en el calendario", async () => {
  const user = await ctx.makeClient();
  await ctx.model("Anthropometry").create({ userId: user._id, date: "2026-06-03", weight: 72.1 });

  // Leer el día devuelve también el peso.
  assert.equal((await readDay(user, "2026-06-03")).anthropometry.weight, 72.1);

  // Peso de una fecha sin día: el calendario la pinta igualmente (día virtual).
  await ctx.model("Anthropometry").create({ userId: user._id, date: "2026-06-05", weight: 71.8 });
  const calendar = await ctx.get(user, "/dietdays/range?from=2026-06-01&to=2026-06-30");
  const byDate = Object.fromEntries(calendar.map((d) => [d.date, d]));
  assert.equal(byDate["2026-06-03"].weight, 72.1);
  assert.equal(byDate["2026-06-05"].weight, 71.8);
  assert.deepEqual(byDate["2026-06-05"].meals, []);
  assert.deepEqual(calendar.map((d) => d.date), [...calendar.map((d) => d.date)].sort().reverse(), "orden descendente");
});

test("calendario: solo los días del usuario y dentro del rango, con los macros de sus alimentos", async () => {
  const user = await ctx.makeClient();
  const other = await ctx.makeClient();
  await addFood(user, "2026-07-01", 0, food("Huevo", { kcal: 155, quantity: 120 }));
  await addFood(user, "2026-07-31", 0, food("Fuera"));
  await addFood(other, "2026-07-02", 0, food("Ajeno"));
  const days = await ctx.get(user, "/dietdays/range?from=2026-07-01&to=2026-07-30");
  assert.deepEqual(days.map((d) => d.date), ["2026-07-01"]);
  const cp = days[0].meals[0].customProducts[0];
  assert.equal(cp.quantity, 120);
});

// --- Pegar día y borrar día ---------------------------------------------------------

test("pegar un día: sustituye contenido y nota del destino, conserva su menú, borra lo anterior y la copia es independiente", async () => {
  const user = await ctx.makeClient();
  await addFood(user, "2026-08-01", 0, food("Croissant"));
  await addFood(user, "2026-08-01", 2, food("Paella"));
  await ctx.put(user, "/dietdays/date/2026-08-01/notes", { notes: "origen" });
  await addFood(user, "2026-08-02", 4, food("Pizza vieja"));
  await ctx.model("DietDay").updateOne({ userId: user._id, date: "2026-08-02" }, { $set: { menuName: "Menú A" } });

  const source = (await readDay(user, "2026-08-01")).dietDay;
  const target = (await readDay(user, "2026-08-02")).dietDay;
  const oldPizza = mealAt(target, 4).customProducts[0]._id;
  const oldMealIds = target.meals.map((m) => m._id);

  await ctx.put(user, "/dietdays/date/2026-08-02/paste", { dietDayClipboard: source });

  const pasted = (await readDay(user, "2026-08-02")).dietDay;
  assert.equal(pasted._id, target._id, "es el mismo documento de día");
  assert.equal(pasted.notes, "origen");
  assert.equal(pasted.menuName, "Menú A", "el menú elegido del destino se conserva");
  assert.deepEqual(mealAt(pasted, 0).customProducts.map((cp) => cp.product.name), ["Croissant"]);
  assert.deepEqual(mealAt(pasted, 2).customProducts.map((cp) => cp.product.name), ["Paella"]);
  assert.equal(mealAt(pasted, 4).customProducts.length, 0);
  assert.equal(await ctx.findDiaryItem(oldPizza), null);
  assert.deepEqual(pasted.meals.map((m) => m._id), oldMealIds, "las comidas del destino son las mismas: cambia su contenido");

  // Independencia: cambiar la copia no toca el origen.
  const copied = mealAt(pasted, 0).customProducts[0];
  await ctx.patch(user, `/meals/${mealAt(pasted, 0)._id}/customproducts/${copied._id}/quantity`, { quantity: 5 });
  assert.equal(mealAt((await readDay(user, "2026-08-01")).dietDay, 0).customProducts[0].quantity, 100);
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 2);
});

test("pegar un día en una fecha sin día la estrena (una sola vez)", async () => {
  const user = await ctx.makeClient();
  await addFood(user, "2026-08-10", 1, food("Fruta"));
  const source = (await readDay(user, "2026-08-10")).dietDay;
  await ctx.put(user, "/dietdays/date/2026-08-11/paste", { dietDayClipboard: source });
  await ctx.put(user, "/dietdays/date/2026-08-11/paste", { dietDayClipboard: source });
  assert.equal(await ctx.count("DietDay", { userId: user._id, date: "2026-08-11" }), 1);
  assert.deepEqual(mealAt((await readDay(user, "2026-08-11")).dietDay, 1).customProducts.map((cp) => cp.product.name), ["Fruta"]);
});

test("pegar en fecha inválida: 400 sin crear nada", async () => {
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "PUT", "/dietdays/date/ayer/paste", { dietDayClipboard: { meals: [] } });
  assert.equal(res.status, 400);
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 0);
});

test("borrar un día arrastra sus comidas y alimentos (cascada) y no toca los demás días", async () => {
  const user = await ctx.makeClient();
  await addFood(user, "2026-09-01", 0, food("A"));
  await addFood(user, "2026-09-02", 0, food("B"));
  const day = (await readDay(user, "2026-09-01")).dietDay;
  const mealIds = day.meals.map((m) => m._id);
  const cpIds = day.meals.flatMap((m) => m.customProducts.map((cp) => cp._id));

  const res = await ctx.call(user, "DELETE", "/dietdays/date/2026-09-01");
  assert.equal(res.status, 204);
  assert.equal(await ctx.count("DietDay", { _id: day._id }), 0);
  for (const id of mealIds) assert.equal(await ctx.findMeal(id), null);
  for (const id of cpIds) assert.equal(await ctx.findDiaryItem(id), null);
  assert.equal(mealAt((await readDay(user, "2026-09-02")).dietDay, 0).customProducts.length, 1);

  // La fecha borrada se puede volver a abrir (día nuevo y vacío).
  const reopened = (await readDay(user, "2026-09-01")).dietDay;
  assert.notEqual(reopened._id, day._id);
  assert.equal(mealAt(reopened, 0).customProducts.length, 0);
});

// --- Comida pautada por el profesional --------------------------------------------

async function seedPrescribedMeal(user, date) {
  const trainer = await ctx.makeTrainer();
  await addFood(user, date, 2, food("Pollo pautado", { quantity: 200 }));
  await addFood(user, date, 2, food("Arroz pautado", { quantity: 80 }));
  const day = (await readDay(user, date)).dietDay;
  const meal = mealAt(day, 2);
  await ctx.setMeal(meal._id, { assignedByTrainerId: trainer._id });
  for (const cp of meal.customProducts) {
    await ctx.setDiaryItem(cp._id, { assignedByTrainerId: trainer._id, assignedQuantity: cp.quantity });
  }
  return { trainer, meal: (await readDay(user, date)).dietDay.meals[2] };
}

test("comida pautada: el cliente NO cambia su composición por ninguna vía (403 MEAL_PROTECTED)", async () => {
  const user = await ctx.makeClient();
  const { meal } = await seedPrescribedMeal(user, "2026-10-01");
  const cp = meal.customProducts[0];
  const attempts = [
    ["DELETE", `/meals/${meal._id}/customproducts/${cp._id}`],
    ["DELETE", `/meals/${meal._id}/customproducts`],
    ["DELETE", `/meals/${meal._id}/customrecipes`],
    ["PUT", `/meals/${meal._id}`, { name: "Mía", notes: "x" }],
    ["PUT", `/meals/${meal._id}/paste`, { mealClipboard: { customProducts: [] }, merge: false }],
    ["PUT", `/meals/${meal._id}/paste`, { mealClipboard: { customProducts: [] }, merge: true }],
    ["PUT", `/meals/${meal._id}/customproducts/${cp._id}`, { quantity: 1 }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await ctx.call(user, method, path, body);
    assert.equal(res.status, 403, `${method} ${path} -> ${res.status}`);
    assert.equal(res.body.code, "MEAL_PROTECTED");
  }
  const stored = await ctx.findMeal(meal._id);
  assert.equal(stored.customProducts.length, 2);
  assert.equal(stored.name, "Comida");
  // No hay rutas para borrar una comida suelta (vive en su día).
  assert.equal((await ctx.call(user, "DELETE", `/meals/${meal._id}`)).status, 404);
});

test("comida pautada: registrar cumplimiento SÍ se permite y no toca lo pautado", async () => {
  const user = await ctx.makeClient();
  const { meal } = await seedPrescribedMeal(user, "2026-10-02");
  const cp = meal.customProducts.find((c) => c.product.name === "Pollo pautado");
  await ctx.patch(user, `/meals/${meal._id}/customproducts/${cp._id}/consumed`, { consumed: true });
  await ctx.patch(user, `/meals/${meal._id}/customproducts/${cp._id}/quantity`, { quantity: 150 });
  const stored = await ctx.findDiaryItem(cp._id);
  assert.equal(stored.consumed, true);
  assert.equal(stored.quantity, 150, "lo realmente consumido");
  assert.equal(stored.assignedQuantity, 200, "la referencia pautada no cambia");
});

test("comida pautada: la meta del día (plannedTarget) suma lo pautado con la cantidad pautada", async () => {
  const user = await ctx.makeClient();
  await seedPrescribedMeal(user, "2026-10-03");
  const { plannedTarget } = await readDay(user, "2026-10-03");
  // Pollo 200 g + arroz 80 g, 100 kcal/10 g P/10 g C/2 g G por 100 g.
  assert.deepEqual(plannedTarget, { kcal: 280, protein: 28, carbs: 28, fat: 5.6 });
});

test("comida mixta: el cliente borra lo suyo pero no el alimento pautado, y reemplazarla solo sustituye lo suyo", async () => {
  const user = await ctx.makeClient();
  const trainer = await ctx.makeTrainer();
  const date = "2026-10-04";
  await addFood(user, date, 0, food("Mío"));
  await addFood(user, date, 0, food("Del coach"));
  let meal = mealAt((await readDay(user, date)).dietDay, 0);
  const coachCp = meal.customProducts.find((cp) => cp.product.name === "Del coach");
  await ctx.setDiaryItem(coachCp._id, { assignedByTrainerId: trainer._id });

  assert.equal((await ctx.call(user, "DELETE", `/meals/${meal._id}/customproducts/${coachCp._id}`)).status, 403);
  assert.equal((await ctx.call(user, "PUT", `/meals/${meal._id}/paste`, { mealClipboard: { customProducts: [] }, merge: false })).status, 200);
  meal = mealAt((await readDay(user, date)).dietDay, 0);
  assert.deepEqual(meal.customProducts.map((cp) => cp.product.name), ["Del coach"], "reemplazar con nada vacía lo suyo y deja lo pautado");

  await addFood(user, date, 0, food("Mío"));
  meal = mealAt((await readDay(user, date)).dietDay, 0);
  const mine = meal.customProducts.find((cp) => cp.product.name === "Mío");
  assert.equal((await ctx.call(user, "DELETE", `/meals/${meal._id}/customproducts/${mine._id}`)).status, 200);

  // "Vaciar" solo se lleva lo del cliente.
  await addFood(user, date, 0, food("Otro mío"));
  meal = mealAt((await readDay(user, date)).dietDay, 0);
  await ctx.del(user, `/meals/${meal._id}/customproducts`);
  meal = mealAt((await readDay(user, date)).dietDay, 0);
  assert.deepEqual(meal.customProducts.map((cp) => cp.product.name), ["Del coach"]);
});

test("el cliente no puede desproteger una comida pautada por la vía genérica de modificar comida", async () => {
  const user = await ctx.makeClient();
  const { meal } = await seedPrescribedMeal(user, "2026-10-05");
  await ctx.call(user, "PUT", `/meals/${meal._id}`, { assignedByTrainerId: null, customProducts: [] });
  const stored = await ctx.findMeal(meal._id);
  assert.ok(stored.assignedByTrainerId, "sigue pautada");
  assert.equal(stored.customProducts.length, 2);
});

test("pegar un día encima de otro con una comida pautada entera: esa comida no se toca y el resto se pega", async () => {
  const user = await ctx.makeClient();
  await addFood(user, "2026-10-08", 0, food("Tostada"));
  await addFood(user, "2026-10-08", 2, food("Macarrones"));
  const source = (await readDay(user, "2026-10-08")).dietDay;
  const { meal } = await seedPrescribedMeal(user, "2026-10-09");
  await ctx.put(user, "/dietdays/date/2026-10-09/paste", { dietDayClipboard: source });
  const after = (await readDay(user, "2026-10-09")).dietDay;
  assert.deepEqual(mealAt(after, 0).customProducts.map((cp) => cp.product.name), ["Tostada"]);
  assert.equal(String(mealAt(after, 2)._id), String(meal._id));
  assert.deepEqual(mealAt(after, 2).customProducts.map((cp) => cp.product.name).sort(), ["Arroz pautado", "Pollo pautado"]);
  assert.ok(mealAt(after, 2).assignedByTrainerId, "sigue pautada");
});

test("copiar una comida pautada a otro hueco crea alimentos PROPIOS (no pautados) y no altera la meta del día", async () => {
  const user = await ctx.makeClient();
  const { meal } = await seedPrescribedMeal(user, "2026-10-06");
  const before = (await readDay(user, "2026-10-06")).plannedTarget;
  const day = (await readDay(user, "2026-10-06")).dietDay;
  await ctx.put(user, `/meals/${mealAt(day, 4)._id}/paste`, { mealClipboard: meal, merge: true });
  const after = await readDay(user, "2026-10-06");
  for (const cp of mealAt(after.dietDay, 4).customProducts) assert.equal(cp.assignedByTrainerId ?? null, null);
  assert.deepEqual(after.plannedTarget, before);
});
