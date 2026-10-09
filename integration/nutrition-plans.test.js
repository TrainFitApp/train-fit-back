const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Planes de dieta de punta a punta: plantilla de biblioteca → fase del
// cliente (con su propia copia del contenido) → el cliente elige menú → su
// día se rellena con lo pautado. Y todo lo que tiene que propagarse (o NO
// propagarse) cuando el profesional edita, sustituye o quita la fase, prepara
// la semana siguiente o marca un día saltado.

const ctx = h.setup();

let foods;
ctx.before(async () => {
  const Product = ctx.model("Product");
  foods = {
    avena: await Product.create({ name: "Avena", energyKcal100g: 370, protein100g: 13, carbohydrates100g: 60, fat100g: 7, verified: true }),
    leche: await Product.create({ name: "Leche", energyKcal100g: 47, protein100g: 3.3, carbohydrates100g: 4.8, fat100g: 1.6, verified: true }),
    pollo: await Product.create({ name: "Pollo", energyKcal100g: 165, protein100g: 31, carbohydrates100g: 0, fat100g: 3.6, verified: true }),
    arroz: await Product.create({ name: "Arroz", energyKcal100g: 130, protein100g: 2.7, carbohydrates100g: 28, fat100g: 0.3, verified: true }),
    salmon: await Product.create({ name: "Salmón", energyKcal100g: 208, protein100g: 20, carbohydrates100g: 0, fat100g: 13, verified: true }),
  };
});

const cp = (product, quantity) => ({
  product: String(product._id),
  quantity,
  energyKcal100g: product.energyKcal100g,
  protein100g: product.protein100g,
  carbohydrates100g: product.carbohydrates100g,
  fat100g: product.fat100g,
});

function menus() {
  return [
    {
      name: "Menú A",
      meals: [
        { slot: "Desayuno", alternatives: [{ label: "", customProducts: [cp(foods.avena, 60), cp(foods.leche, 250)] }] },
        { slot: "Comida", alternatives: [{ label: "", customProducts: [cp(foods.pollo, 200), cp(foods.arroz, 80)] }] },
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
  ];
}

async function setupPair() {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  return { trainer, client };
}

async function libraryTemplate(trainer, extra = {}) {
  return ctx.post(trainer, "/trainer/diet-templates", { name: "Definición", menus: menus(), ...extra });
}

const phasesPath = (client) => `/trainer/clients/${client.id}/diet-phases`;

async function applyTemplate(trainer, client, template, startDate = h.day(0), body = {}) {
  return ctx.post(trainer, phasesPath(client), { templateId: template._id, startDate, ...body });
}

const readDay = async (user, date) => ctx.post(user, `/dietdays/date/${date}`, {});
const mealBySlot = (day, slot) => day.meals.find((m) => m.name === slot);
const productNames = (meal) => meal.customProducts.map((c) => c.product?.name || c.name).sort();

// --- Plantillas de biblioteca --------------------------------------------------------

test("plantilla: nombres de menú repetidos se desambiguan, huecos inválidos se descartan y el contenido se materializa", async () => {
  const trainer = await ctx.makeTrainer();
  const tpl = await ctx.post(trainer, "/trainer/diet-templates", {
    name: "  Volumen  ",
    menus: [
      { name: "Día", meals: [{ slot: "Desayuno", alternatives: [{ customProducts: [cp(foods.avena, 80)] }] }, { slot: "Brunch", alternatives: [] }] },
      { name: "Día", meals: [] },
      { name: "", meals: [] },
    ],
  });
  assert.equal(tpl.name, "Volumen");
  assert.deepEqual(tpl.menus.map((m) => m.name), ["Día", "Día (2)", "Menú 3"]);
  assert.deepEqual(tpl.menus[0].meals.map((m) => m.slot), ["Desayuno"], "Brunch no es un hueco válido");
  const stored = await ctx.model("DietTemplate").findById(tpl._id).lean();
  const materialized = stored.menus[0].meals[0].alternatives[0].customProducts;
  assert.equal(materialized.length, 1, "el contenido va embebido en la plantilla");
  assert.equal(materialized[0].quantity, 80);
  assert.ok(materialized[0]._id, "con su propio id");
  assert.equal((await ctx.call(trainer, "POST", "/trainer/diet-templates", { name: "   " })).status, 400);
});

test("plantilla ajena: otro entrenador no la lee, no la edita y no la borra (404)", async () => {
  const owner = await ctx.makeTrainer();
  const other = await ctx.makeTrainer();
  const tpl = await libraryTemplate(owner);
  assert.equal((await ctx.call(other, "GET", `/trainer/diet-templates/${tpl._id}`)).status, 404);
  assert.equal((await ctx.call(other, "PUT", `/trainer/diet-templates/${tpl._id}`, { name: "Mía" })).status, 404);
  assert.equal((await ctx.call(other, "DELETE", `/trainer/diet-templates/${tpl._id}`)).status, 404);
  assert.equal((await ctx.get(owner, `/trainer/diet-templates/${tpl._id}`)).name, "Definición");
  const client = await ctx.makeClient();
  assert.equal((await ctx.call(owner, "POST", "/trainer/diet-templates", { name: "Para alguien", ownerClientId: client.id })).status, 403,
    "una plantilla exclusiva de cliente exige relación");
});

test("editar una plantilla de biblioteca reemplaza su contenido entero", async () => {
  const trainer = await ctx.makeTrainer();
  const tpl = await libraryTemplate(trainer);
  const oldIds = tpl.menus.flatMap((m) => m.meals.flatMap((meal) => meal.alternatives.flatMap((a) => a.customProducts.map((c) => String(c._id || c)))));
  await ctx.put(trainer, `/trainer/diet-templates/${tpl._id}`, { menus: [{ name: "Único", meals: [{ slot: "Cena", alternatives: [{ customProducts: [cp(foods.salmon, 120)] }] }] }] });
  const items = ctx.collectItems(await ctx.model("DietTemplate").findById(tpl._id).lean());
  assert.deepEqual(items.map((item) => item.quantity), [120]);
  assert.ok(items.every((item) => !oldIds.includes(String(item._id))));
  const stored = await ctx.get(trainer, `/trainer/diet-templates/${tpl._id}`);
  assert.deepEqual(stored.menus.map((m) => m.name), ["Único"]);
});

// --- Asignar y elegir menú ------------------------------------------------------------

test("asignar: la fase lleva su propia COPIA del contenido, activa desde su fecha, con el nombre de la plantilla", async () => {
  const { trainer, client } = await setupPair();
  const tpl = await libraryTemplate(trainer);
  const phase = await applyTemplate(trainer, client, tpl);
  assert.equal(phase.name, "Definición");
  assert.equal(String(phase.sourceTemplateId), String(tpl._id));
  assert.deepEqual(phase.contents.map((c) => [c.startDate, c.menusCount]), [[h.day(0), 2]]);

  const stored = await ctx.model("DietPhase").findById(phase._id).lean();
  const copyIds = stored.contents[0].menus.flatMap((m) => m.meals.flatMap((meal) => meal.alternatives.flatMap((a) => a.customProducts.map((c) => String(c._id)))));
  const tplIds = tpl.menus.flatMap((m) => m.meals.flatMap((meal) => meal.alternatives.flatMap((a) => a.customProducts.map((c) => String(c._id)))));
  assert.ok(copyIds.length > 0);
  assert.ok(copyIds.every((id) => !tplIds.includes(id)), "no comparte alimentos con la plantilla");
  assert.equal(await ctx.count("DietTemplate", { trainerId: trainer._id }), 1, "aplicar no crea plantillas");

  const current = await ctx.get(trainer, `${phasesPath(client)}/current`);
  assert.equal(String(current._id), String(phase._id));
  assert.equal(current.stuckDaysCount, 0);
  await readDay(client, h.day(0));
  assert.equal((await ctx.get(trainer, `${phasesPath(client)}/current`)).stuckDaysCount, 1, "día abierto sin menú elegido");
  const full = await ctx.get(trainer, `${phasesPath(client)}/${phase._id}`);
  assert.deepEqual(full.contents[0].menus.map((m) => m.name), ["Menú A", "Menú B"]);
  assert.equal(full.contents[0].menus[0].meals[0].alternatives[0].customProducts[0].product.name, "Avena", "con los alimentos poblados");
});

test("el cliente ve los menús a elegir (con vista previa) y al elegir uno su día se rellena con lo pautado", async () => {
  const { trainer, client } = await setupPair();
  const tpl = await libraryTemplate(trainer);
  await applyTemplate(trainer, client, tpl);
  const date = h.day(0);

  const menu = await ctx.get(client, `/dietdays/date/${date}/menu`);
  assert.equal(menu.needsChoice, true);
  assert.deepEqual(menu.options, ["Menú A", "Menú B"]);
  assert.ok(menu.previews?.length === 2);

  // Sin elegir: el día existe pero sin nada pautado ni meta.
  let read = await readDay(client, date);
  assert.equal(read.plannedTarget, null);
  assert.equal(mealBySlot(read.dietDay, "Desayuno").customProducts.length, 0);

  const chosen = await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  assert.equal(chosen.menuName, "Menú A");
  read = await readDay(client, date);
  const desayuno = mealBySlot(read.dietDay, "Desayuno");
  assert.deepEqual(productNames(desayuno), ["Avena", "Leche"]);
  for (const item of desayuno.customProducts) {
    assert.equal(String(item.assignedByTrainerId), trainer.id, "marcado como pautado por el profesional");
    assert.equal(item.assignedQuantity, item.quantity);
  }
  // Meta = suma de lo pautado: avena 60 + leche 250 + pollo 200 + arroz 80.
  const kcal = 370 * 0.6 + 47 * 2.5 + 165 * 2 + 130 * 0.8;
  assert.equal(read.plannedTarget.kcal, Math.round(kcal));
  assert.equal((await ctx.get(client, `/dietdays/date/${date}/menu`)).needsChoice, false);
});

test("cambiar de menú sustituye lo pautado (sin restos del anterior) y respeta lo que el cliente añadió", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  await ctx.post(client, `/dietdays/date/${date}/meals/2/customproducts`, { customProduct: { quantity: 30, product: { name: "Pan propio", energyKcal100g: 250 } } });

  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú B" });
  const day = (await readDay(client, date)).dietDay;
  assert.equal(day.menuName, "Menú B");
  assert.equal(mealBySlot(day, "Desayuno").customProducts.length, 0, "el desayuno de A desaparece");
  assert.deepEqual(productNames(mealBySlot(day, "Comida")), ["Pan propio", "Pollo"], "primera opción de B + lo propio");
  assert.equal(await ctx.count("DietDay", { userId: client._id, date }), 1);
});

test("menú con opciones: la primera se aplica sola, el cliente puede alternar y volver sin duplicar", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú B" });

  let comida = mealBySlot((await readDay(client, date)).dietDay, "Comida");
  assert.deepEqual(comida.alternatives.map((a) => a.label), ["Pollo", "Salmón"]);
  assert.equal(comida.chosenAlternativeIndex, 0);

  await ctx.put(client, `/meals/${comida._id}/alternative`, { chosenIndex: 1 });
  comida = mealBySlot((await readDay(client, date)).dietDay, "Comida");
  assert.deepEqual(productNames(comida), ["Salmón"]);
  assert.equal(comida.chosenAlternativeIndex, 1);
  await ctx.put(client, `/meals/${comida._id}/alternative`, { chosenIndex: 0 });
  await ctx.put(client, `/meals/${comida._id}/alternative`, { chosenIndex: 0 });
  comida = mealBySlot((await readDay(client, date)).dietDay, "Comida");
  assert.deepEqual(productNames(comida), ["Pollo"], "sin duplicados al repetir");
  assert.equal(comida.alternatives.length, 2, "las opciones siguen ahí");

  assert.equal((await ctx.call(client, "PUT", `/meals/${comida._id}/alternative`, { chosenIndex: 7 })).status, 400);
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(stranger, "PUT", `/meals/${comida._id}/alternative`, { chosenIndex: 1 })).status, 400);
});

test("elegir un menú que no existe o sin plan: 400; fecha inválida: 400", async () => {
  const { trainer, client } = await setupPair();
  assert.equal((await ctx.call(client, "PUT", `/dietdays/date/${h.day(0)}/menu`, { menuName: "Menú A" })).status, 400, "sin plan");
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  assert.equal((await ctx.call(client, "PUT", `/dietdays/date/${h.day(0)}/menu`, { menuName: "Menú Z" })).status, 400);
  assert.equal((await ctx.call(client, "PUT", `/dietdays/date/${h.day(0)}/menu`, {})).status, 400);
  assert.equal((await ctx.call(client, "PUT", "/dietdays/date/hoy/menu", { menuName: "Menú A" })).status, 400);
  // Antes de que empiece la fase no hay nada que elegir.
  const before = await ctx.get(client, `/dietdays/date/${h.day(-3)}/menu`);
  assert.equal(before.needsChoice, false);
});

test("salir del menú: quita lo pautado y la elección, conserva lo propio", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  await ctx.post(client, `/dietdays/date/${date}/meals/0/customproducts`, { customProduct: { quantity: 10, product: { name: "Miel propia" } } });
  const left = await ctx.del(client, `/dietdays/date/${date}/menu`);
  assert.equal(left.menuName, null);
  const day = (await readDay(client, date)).dietDay;
  assert.deepEqual(productNames(mealBySlot(day, "Desayuno")), ["Miel propia"]);
  assert.equal(mealBySlot(day, "Comida").customProducts.length, 0);
  assert.equal((await readDay(client, date)).plannedTarget, null);
  assert.equal((await ctx.get(client, `/dietdays/date/${date}/menu`)).needsChoice, true);
});

// --- Lo que se propaga y lo que no ----------------------------------------------------

test("editar la PLANTILLA después de asignarla no cambia nada del cliente (copia congelada)", async () => {
  const { trainer, client } = await setupPair();
  const tpl = await libraryTemplate(trainer);
  await applyTemplate(trainer, client, tpl);
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });

  await ctx.put(trainer, `/trainer/diet-templates/${tpl._id}`, { menus: [{ name: "Menú A", meals: [{ slot: "Desayuno", alternatives: [{ customProducts: [cp(foods.salmon, 500)] }] }] }] });
  assert.deepEqual(productNames(mealBySlot((await readDay(client, date)).dietDay, "Desayuno")), ["Avena", "Leche"]);

  // Y borrarla tampoco.
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/diet-templates/${tpl._id}`)).status, 204);
  assert.deepEqual(productNames(mealBySlot((await readDay(client, date)).dietDay, "Desayuno")), ["Avena", "Leche"]);
  assert.equal((await ctx.get(client, `/dietdays/date/${date}/menu`)).options.length, 2);
});

test("editar el contenido de la fase resincroniza los días ya abiertos del cliente que aún no ha seguido", async () => {
  const { trainer, client } = await setupPair();
  const phase = await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const today = h.day(0);
  const tomorrow = h.day(1);
  await ctx.put(client, `/dietdays/date/${today}/menu`, { menuName: "Menú A" });
  await ctx.put(client, `/dietdays/date/${tomorrow}/menu`, { menuName: "Menú A" });
  // Hoy ya marcó algo como tomado: ese día no se toca.
  const desayunoHoy = mealBySlot((await readDay(client, today)).dietDay, "Desayuno");
  await ctx.patch(client, `/meals/${desayunoHoy._id}/customproducts/${desayunoHoy.customProducts[0]._id}/consumed`, { consumed: true });

  const newMenus = menus();
  newMenus[0].meals[0].alternatives[0].customProducts = [cp(foods.avena, 90)];
  await ctx.put(trainer, `${phasesPath(client)}/${phase._id}/contents/${phase.contents[0]._id}`, { menus: newMenus });

  const manana = mealBySlot((await readDay(client, tomorrow)).dietDay, "Desayuno");
  assert.deepEqual(manana.customProducts.map((c) => [c.product.name, c.quantity]), [["Avena", 90]], "mañana ya lleva lo nuevo");
  const hoy = mealBySlot((await readDay(client, today)).dietDay, "Desayuno");
  assert.deepEqual(productNames(hoy), ["Avena", "Leche"], "hoy ya lo estaba siguiendo: se queda como estaba");
});

test("otra fase que empieza hoy: la anterior acaba ayer y cada fecha resuelve con la suya", async () => {
  const { trainer, client } = await setupPair();
  const first = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-5));
  const second = await ctx.post(trainer, phasesPath(client), {
    name: "Mantenimiento",
    startDate: h.day(0),
    menus: [{ name: "Único", meals: [{ slot: "Cena", alternatives: [{ customProducts: [cp(foods.salmon, 150)] }] }] }],
  });
  assert.equal(second.sourceTemplateId, null);
  const history = await ctx.get(trainer, phasesPath(client));
  assert.deepEqual(history.map((p) => [p.name, p.state]), [["Mantenimiento", "current"], ["Definición", "past"]], "una entrada por fase, la más reciente primero");
  const old = history.find((p) => String(p._id) === String(first._id));
  assert.equal(old.endDate, h.day(-1));
  const stored = await ctx.model("DietPhase").collection.findOne({ _id: ctx.oid(first._id) });
  assert.deepEqual(["status" in stored, "supersededBy" in stored], [false, false], "el estado de la cadena sale de las fechas");
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Único"]);
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(-2)}/menu`)).options, ["Menú A", "Menú B"], "el pasado sigue con la anterior");
});

test("sustituir una fase el MISMO día en que empezó: desde hoy manda la nueva", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(0));
  await ctx.post(trainer, phasesPath(client), {
    name: "Corrección",
    startDate: h.day(0),
    menus: [{ name: "Único", meals: [] }],
  });
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Único"]);
});

test("sustituir otra vez el mismo día: la ya sustituida no bloquea y manda la última", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(0));
  await ctx.post(trainer, phasesPath(client), { name: "Corrección", startDate: h.day(0), menus: [{ name: "Único", meals: [] }] });
  const third = await ctx.call(trainer, "POST", phasesPath(client), {
    name: "Segunda corrección",
    startDate: h.day(0),
    menus: [{ name: "Otro", meals: [] }],
  });
  assert.equal(third.status, 201, "antes daba 409: la sustituida (inicio y fin hoy) contaba como choque");
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Otro"]);
  assert.equal((await ctx.get(trainer, `${phasesPath(client)}/current`)).name, "Segunda corrección");

  // Ponerle fin tampoco choca con las sustituidas (antes, 409 PLAN_OVERLAP).
  const ended = await ctx.patch(trainer, `${phasesPath(client)}/${third.body._id}`, { endDate: h.day(5) });
  assert.equal(ended.endDate, h.day(5));
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Otro"], "la sustituida sigue tapada");

  // Una fase programada más adelante sí impide empezar antes que ella.
  await ctx.post(trainer, phasesPath(client), { name: "Programada", startDate: h.day(10), menus: [{ name: "Único", meals: [] }] });
  const beforeScheduled = await ctx.call(trainer, "POST", phasesPath(client), { name: "Encima", startDate: h.day(0), menus: [{ name: "Único", meals: [] }] });
  assert.equal(beforeScheduled.status, 409);
  assert.equal(beforeScheduled.body.code, "PLAN_OVERLAP");
  assert.match(beforeScheduled.body.message, /Programada/);
});

test("empezar más adelante con una fase en curso: la corta el día anterior y pierde lo preparado desde entonces", async () => {
  const { trainer, client } = await setupPair();
  const first = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-5));
  const prepared = [h.day(2), h.day(9)];
  await ctx.model("DietPhase").updateOne(
    { _id: ctx.oid(first._id) },
    { $push: { contents: { $each: prepared.map((startDate) => ({ startDate, menus: [] })) } }, $inc: { __v: 1 } }
  );

  const later = await ctx.call(trainer, "POST", phasesPath(client), {
    name: "Siguiente",
    startDate: h.day(7),
    menus: [{ name: "Único", meals: [] }],
  });
  assert.equal(later.status, 201, "antes daba 409: programar con otra fase en curso se rechazaba");
  const history = await ctx.get(trainer, phasesPath(client));
  assert.deepEqual(
    history.map((p) => [p.name, p.state, p.endDate]),
    [["Siguiente", "scheduled", null], ["Definición", "current", h.day(6)]]
  );
  const cut = await ctx.model("DietPhase").findById(first._id).lean();
  assert.deepEqual(cut.contents.map((c) => c.startDate), [h.day(-5), h.day(2)], "lo preparado desde el corte nunca va a correr");
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Menú A", "Menú B"], "hasta entonces, la que estaba");
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(7)}/menu`)).options, ["Único"]);

  // Quitarla vuelve a dejar abierta la anterior.
  assert.equal((await ctx.call(trainer, "DELETE", `${phasesPath(client)}/${later.body._id}`)).status, 204);
  assert.equal((await ctx.model("DietPhase").findById(first._id).lean()).endDate, null);
});

test("una fase futura no empieza antes que otra programada ni el mismo día que ella (409 PLAN_OVERLAP); después, la corta", async () => {
  const { trainer, client } = await setupPair();
  const tpl = await libraryTemplate(trainer);
  const scheduled = await applyTemplate(trainer, client, tpl, h.day(10));
  for (const startDate of [h.day(5), h.day(10)]) {
    const clash = await ctx.call(trainer, "POST", phasesPath(client), { templateId: tpl._id, startDate });
    assert.equal(clash.status, 409, startDate);
    assert.equal(clash.body.code, "PLAN_OVERLAP");
    assert.match(clash.body.message, /Definición/);
  }
  const after = await ctx.call(trainer, "POST", phasesPath(client), { name: "Encima", startDate: h.day(12), menus: [{ name: "Único", meals: [] }] });
  assert.equal(after.status, 201);
  assert.equal((await ctx.model("DietPhase").findById(scheduled._id).lean()).endDate, h.day(11));

  assert.equal((await ctx.call(trainer, "POST", phasesPath(client), { templateId: tpl._id, startDate: "mañana" })).status, 400);
  assert.equal((await ctx.call(trainer, "POST", phasesPath(client), { startDate: h.day(20), menus: [] })).status, 400, "sin plantilla hace falta nombre");
  const otherTrainer = await ctx.makeTrainer();
  const foreign = await libraryTemplate(otherTrainer);
  assert.equal((await ctx.call(trainer, "POST", phasesPath(client), { templateId: foreign._id, startDate: h.day(20) })).status, 404, "solo plantillas propias");
});

test("quitar la fase vigente reactiva la anterior: el cliente vuelve a ver sus menús", async () => {
  const { trainer, client } = await setupPair();
  const first = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-5));
  const second = await ctx.post(trainer, phasesPath(client), {
    name: "Corta",
    startDate: h.day(0),
    menus: [{ name: "Solo cena", meals: [] }],
  });
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Solo cena"]);

  assert.equal((await ctx.call(trainer, "DELETE", `${phasesPath(client)}/${second._id}`)).status, 204);
  const current = await ctx.get(trainer, `${phasesPath(client)}/current`);
  assert.equal(String(current._id), String(first._id));
  assert.equal(current.state, "current");
  assert.equal(current.endDate, null, "vuelve a ser indefinida");
  assert.deepEqual((await ctx.get(client, `/dietdays/date/${h.day(0)}/menu`)).options, ["Menú A", "Menú B"]);
  assert.equal((await ctx.call(trainer, "DELETE", `${phasesPath(client)}/${second._id}`)).status, 404);
});

test("una fase que ya había terminado conserva su fin cuando la siguiente empieza tras un hueco; quitar esa siguiente no la reabre", async () => {
  const { trainer, client } = await setupPair();
  const first = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-20));
  await ctx.patch(trainer, `${phasesPath(client)}/${first._id}`, { endDate: h.day(-10) });
  const next = await ctx.post(trainer, phasesPath(client), { name: "Tras el hueco", startDate: h.day(0), menus: [{ name: "Único", meals: [] }] });
  assert.equal((await ctx.model("DietPhase").findById(first._id).lean()).endDate, h.day(-10), "el hueco no se rellena con la fase vieja");
  assert.equal((await ctx.call(trainer, "DELETE", `${phasesPath(client)}/${next._id}`)).status, 204);
  assert.equal((await ctx.model("DietPhase").findById(first._id).lean()).endDate, h.day(-10), "no la había cortado: sigue terminada");
  assert.equal(await ctx.get(trainer, `${phasesPath(client)}/current`), null);
});

test("quitar una fase deja limpios los días que el cliente ya había resuelto con ella", async () => {
  const { trainer, client } = await setupPair();
  const phase = await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  assert.equal((await ctx.call(trainer, "DELETE", `${phasesPath(client)}/${phase._id}`)).status, 204);
  const read = await readDay(client, date);
  assert.equal(read.plannedTarget, null);
  assert.equal(mealBySlot(read.dietDay, "Desayuno").customProducts.length, 0);
});

test("una fase no se borra por la ruta de plantillas de biblioteca", async () => {
  const { trainer, client } = await setupPair();
  const phase = await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const res = await ctx.call(trainer, "DELETE", `/trainer/diet-templates/${phase._id}`);
  assert.equal(res.status, 404);
  assert.ok(await ctx.model("DietPhase").exists({ _id: phase._id }));
});

// --- Semanas, fechas y nombre de la fase -------------------------------------------------

test("preparar la semana siguiente añade una versión del contenido DENTRO de la fase, desde su lunes; descartarla vuelve a heredar", async () => {
  const { trainer, client } = await setupPair();
  const phase = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(0), {
    name: "Bloque 1",
    target: { kcal: 2100, protein: 150, carbs: 220, fat: 70 },
  });
  assert.equal(phase.name, "Bloque 1");
  assert.equal(phase.target.kcal, 2100);
  const weeksPath = `${phasesPath(client)}/${phase._id}/weeks`;

  const weeks = await ctx.get(trainer, weeksPath);
  assert.equal(weeks.phaseName, "Bloque 1");
  assert.equal(weeks.current.number, 1);
  assert.equal(weeks.next.content, null, "nada preparado: hereda");
  assert.equal(weeks.next.inherits.id, String(phase.contents[0]._id));

  const scaled = await ctx.post(trainer, `${weeksPath}/next/scale`, { kcal: weeks.current.content.profile.kcal * 2 });
  assert.equal(scaled.factor, 2);
  assert.equal(scaled.menus[0].meals[0].alternatives[0].customProducts[0].quantity, 120, "avena 60 g x 2");

  // Mismo contenido que el que heredaría: no se guarda nada.
  assert.equal((await ctx.call(trainer, "PUT", `${weeksPath}/next`, { menus: menus() })).status, 204);

  const lighter = menus();
  lighter[0].meals[0].alternatives[0].customProducts = [cp(foods.avena, 40)];
  const prepared = await ctx.put(trainer, `${weeksPath}/next`, { menus: lighter });
  assert.deepEqual(prepared.contents.map((c) => c.startDate), [h.day(0), weeks.next.start]);
  assert.equal(await ctx.count("DietPhase", { clientId: client._id }), 1, "sigue siendo una sola fase");

  // El cliente, ese lunes, come lo nuevo; hoy, lo de siempre.
  await ctx.put(client, `/dietdays/date/${weeks.next.start}/menu`, { menuName: "Menú A" });
  const monday = mealBySlot((await readDay(client, weeks.next.start)).dietDay, "Desayuno");
  assert.deepEqual(monday.customProducts.map((c) => [c.product.name, c.quantity]), [["Avena", 40]]);
  assert.equal((await ctx.get(trainer, weeksPath)).next.content.id, String(prepared.contents[1]._id));

  assert.equal((await ctx.call(trainer, "DELETE", `${weeksPath}/next`)).status, 204);
  assert.equal((await ctx.get(trainer, `${phasesPath(client)}/${phase._id}`)).contents.length, 1);
  const back = mealBySlot((await readDay(client, weeks.next.start)).dietDay, "Desayuno");
  assert.deepEqual(back.customProducts.map((c) => [c.product.name, c.quantity]), [["Avena", 60], ["Leche", 250]], "vuelve a heredar");

  const need = await ctx.get(trainer, `${weeksPath}/1/need`);
  assert.equal(need.weekNumber, 1);
  assert.equal(need.target.kcal, 2100);
  assert.equal((await ctx.call(trainer, "GET", `${weeksPath}/0/need`)).status, 400);
  assert.equal((await ctx.call(trainer, "GET", `${weeksPath}/99/need`)).status, 404);
});

test("renombrar y mover las fechas de una fase: el contenido se mueve con ella y no puede pisar otra", async () => {
  const { trainer, client } = await setupPair();
  const tpl = await libraryTemplate(trainer);
  const phase = await applyTemplate(trainer, client, tpl, h.day(2));

  const renamed = await ctx.patch(trainer, `${phasesPath(client)}/${phase._id}`, { name: "Arranque" });
  assert.equal(renamed.name, "Arranque");
  assert.equal((await ctx.call(trainer, "PATCH", `${phasesPath(client)}/${phase._id}`, { name: " " })).status, 400);

  const moved = await ctx.patch(trainer, `${phasesPath(client)}/${phase._id}`, { startDate: h.day(4), endDate: h.day(20) });
  assert.deepEqual([moved.startDate, moved.endDate], [h.day(4), h.day(20)]);
  assert.deepEqual(moved.contents.map((c) => c.startDate), [h.day(4)], "el contenido empieza con la fase");
  assert.equal((await ctx.call(trainer, "PATCH", `${phasesPath(client)}/${phase._id}`, { startDate: h.day(10), endDate: h.day(5) })).status, 409);

  const next = await applyTemplate(trainer, client, tpl, h.day(21));
  const clash = await ctx.call(trainer, "PATCH", `${phasesPath(client)}/${phase._id}`, { endDate: h.day(25) });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, "PLAN_OVERLAP");
  assert.ok(next._id);
});

test("historial y calendario de nutrición: una fase con sus semanas", async () => {
  const { trainer, client } = await setupPair();
  const phase = await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-10));
  const history = await ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-history`);
  assert.ok(history.events.some((e) => e.type === "phase_started" && e.phaseId === String(phase._id)));
  const weekEvents = history.events.filter((e) => e.type === "week");
  assert.ok(weekEvents.length >= 2);
  assert.ok(weekEvents.every((e) => e.contentId === String(phase.contents[0]._id)));

  const timeline = await ctx.get(trainer, `/trainer/clients/${client.id}/diet-timeline?from=${h.day(-20)}&to=${h.day(5)}`);
  assert.deepEqual(timeline.phases.map((p) => [p.id, p.name, p.start]), [[String(phase._id), "Definición", h.day(-10)]]);
  assert.ok(timeline.weeks.length >= 2);
  assert.deepEqual(await ctx.get(client, `/dietdays/timeline?from=${h.day(-20)}&to=${h.day(5)}`), timeline);
});

// --- Días saltados ---------------------------------------------------------------------

test("día saltado: el profesional lo vacía de lo pautado (lo propio se queda), el cliente ya no puede elegir menú y la meta desaparece", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  await ctx.post(client, `/dietdays/date/${date}/meals/4/customproducts`, { customProduct: { quantity: 100, product: { name: "Pizza de cumpleaños" } } });

  // El profesional mira ese día en la ficha y lo marca saltado.
  await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${date}`);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/skipped-days`, { date })).status, 201);

  const read = await readDay(client, date);
  assert.equal(read.dietDay.skipped, true);
  assert.equal(read.dietDay.menuName, null);
  assert.equal(read.plannedTarget, null);
  assert.deepEqual(productNames(mealBySlot(read.dietDay, "Cena")), ["Pizza de cumpleaños"]);
  assert.equal(mealBySlot(read.dietDay, "Desayuno").customProducts.length, 0);

  const menu = await ctx.get(client, `/dietdays/date/${date}/menu`);
  assert.equal(menu.skipped, true);
  assert.equal(menu.needsChoice, false);
  const choose = await ctx.call(client, "PUT", `/dietdays/date/${date}/menu`, { menuName: "Menú A" });
  assert.equal(choose.status, 409);
});

// La ficha ofrece saltar cualquier día dentro de una fase, también los que el
// cliente todavía no ha abierto (los de la semana que viene), y ya no lee el
// día al elegirlo en el calendario: nada ha creado su DietDay. Daba 404.
test("saltar un día del plan que el cliente aún no ha abierto: nace saltado y sin nada pautado", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  const date = h.day(3);

  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/skipped-days`, { date })).status, 201);
  // Repetirlo no falla ni crea otro día.
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/skipped-days`, { date })).status, 201);

  const menu = await ctx.get(client, `/dietdays/date/${date}/menu`);
  assert.equal(menu.skipped, true);
  assert.equal(menu.needsChoice, false);
  const read = await readDay(client, date);
  assert.equal(read.dietDay.skipped, true);
  assert.equal(read.plannedTarget, null);
  assert.ok(read.dietDay.meals.every((meal) => !meal.customProducts.length && !meal.customRecipes.length));
});

test("saltar un día fuera de plan o con fecha inválida: 400", async () => {
  const { trainer, client } = await setupPair();
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/skipped-days`, { date: h.day(0) })).status, 400);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/skipped-days`, { date: "x" })).status, 400);
});

// --- Pautar una comida suelta (F12) ------------------------------------------------------

test("pautar una comida (reemplazar): queda bloqueada para el cliente, avisa y la ve igual el entrenador", async () => {
  const { trainer, client } = await setupPair();
  const date = h.day(2);
  const day = await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${date}`);
  const comida = mealBySlot(day, "Comida");
  await ctx.post(client, `/dietdays/date/${date}/meals/2/customproducts`, { customProduct: { quantity: 50, product: { name: "Lo mío" } } });

  await ctx.post(trainer, `/trainer/clients/${client.id}/diet-days/${date}/meals/${comida._id}/prescribe`, {
    customProducts: [cp(foods.pollo, 150)],
    merge: false,
  });
  const read = await readDay(client, date);
  const meal = mealBySlot(read.dietDay, "Comida");
  assert.deepEqual(productNames(meal), ["Pollo"], "reemplazar se lleva lo anterior");
  assert.equal(String(meal.assignedByTrainerId), trainer.id);
  assert.equal(read.plannedTarget.kcal, Math.round(165 * 1.5));
  assert.equal((await ctx.call(client, "DELETE", `/meals/${meal._id}/customproducts/${meal.customProducts[0]._id}`)).body.code, "MEAL_PROTECTED");

  const notes = await ctx.get(client, "/notifications/mine");
  assert.ok((Array.isArray(notes) ? notes : notes.notifications || []).some((n) => n.type === "meal_prescribed"));
  // El entrenador ve lo mismo.
  const trainerView = mealBySlot(await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${date}`), "Comida");
  assert.deepEqual(productNames(trainerView), ["Pollo"]);
});

test("pautar una comida (combinar): conserva lo del cliente y la comida NO se bloquea entera", async () => {
  const { trainer, client } = await setupPair();
  const date = h.day(3);
  await ctx.post(client, `/dietdays/date/${date}/meals/0/customproducts`, { customProduct: { quantity: 20, product: { name: "Café propio" } } });
  const day = await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=${date}`);
  const desayuno = mealBySlot(day, "Desayuno");
  await ctx.post(trainer, `/trainer/clients/${client.id}/diet-days/${date}/meals/${desayuno._id}/prescribe`, {
    customProducts: [cp(foods.avena, 40)],
    merge: true,
  });
  const meal = mealBySlot((await readDay(client, date)).dietDay, "Desayuno");
  assert.deepEqual(productNames(meal), ["Avena", "Café propio"]);
  assert.equal(meal.assignedByTrainerId ?? null, null);
  const own = meal.customProducts.find((c) => c.product.name === "Café propio");
  assert.equal((await ctx.call(client, "DELETE", `/meals/${meal._id}/customproducts/${own._id}`)).status, 200);
});

test("pautar en una comida que no es de ese cliente/fecha: rechazado", async () => {
  const { trainer, client } = await setupPair();
  const other = await ctx.makeClient();
  const otherDay = (await readDay(other, h.day(0))).dietDay;
  const res = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/diet-days/${h.day(0)}/meals/${otherDay.meals[0]._id}/prescribe`, {
    customProducts: [cp(foods.pollo, 100)],
  });
  assert.ok(res.status >= 400, String(res.status));
  assert.equal((await ctx.findMeal(otherDay.meals[0]._id)).customProducts.length, 0);
});

// --- Lista de la compra ------------------------------------------------------------------

test("lista de la compra: sale de los menús elegidos en el rango y es la misma para cliente y profesional", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer));
  await ctx.put(client, `/dietdays/date/${h.day(0)}/menu`, { menuName: "Menú A" });
  await ctx.put(client, `/dietdays/date/${h.day(1)}/menu`, { menuName: "Menú A" });
  const from = h.day(0);
  const to = h.day(1);
  const mine = await ctx.get(client, `/dietdays/shopping-list?from=${from}&to=${to}`);
  const theirs = await ctx.get(trainer, `/trainer/clients/${client.id}/shopping-list?from=${from}&to=${to}`);
  assert.deepEqual(mine, theirs);
  const serialized = JSON.stringify(mine);
  assert.ok(serialized.includes("Avena") && serialized.includes("Pollo"), serialized.slice(0, 300));
  assert.equal((await ctx.call(client, "GET", "/dietdays/shopping-list?from=2026-01-01&to=2026-12-31")).status, 400, "rango de más de 62 días");
});

// --- Resumen de un día (Plan › Nutrición › Día) ------------------------------------------

const nutritionDay = (trainer, client, date) => ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-day?date=${date}`);

test("resumen del día: menú y opción elegidos, lo tomado (en otra cantidad), lo propio y la desviación", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-3));
  const date = h.day(0);
  await ctx.put(client, `/dietdays/date/${date}/menu`, { menuName: "Menú B" });
  const comida = mealBySlot((await readDay(client, date)).dietDay, "Comida");
  await ctx.put(client, `/meals/${comida._id}/alternative`, { chosenIndex: 1 });
  const salmon = mealBySlot((await readDay(client, date)).dietDay, "Comida").customProducts[0];
  await ctx.patch(client, `/meals/${comida._id}/customproducts/${salmon._id}/quantity`, { quantity: 200 });
  await ctx.patch(client, `/meals/${comida._id}/customproducts/${salmon._id}/consumed`, { consumed: true });
  await ctx.post(client, `/dietdays/date/${date}/meals/4/customproducts`, {
    customProduct: { quantity: 100, product: { name: "Pizza propia", energyKcal100g: 270, protein100g: 11, carbohydrates100g: 33, fat100g: 10 } },
  });

  const day = await nutritionDay(trainer, client, date);
  assert.equal(day.state, "menu");
  assert.equal(day.menuName, "Menú B");
  assert.deepEqual(day.menus, ["Menú A", "Menú B"]);
  assert.equal(day.phase.name, "Definición");
  assert.deepEqual(day.meals.map((m) => [m.name, m.status]), [["Comida", "done"], ["Cena", "extra"]]);
  assert.deepEqual(day.meals[0].options, { chosen: 1, labels: ["Pollo", "Salmón"] });
  assert.deepEqual(
    day.meals[0].items.map((i) => [i.name, i.status, i.plannedQuantity, i.quantity]),
    [["Salmón", "eaten", 150, 200]]
  );
  assert.deepEqual(day.meals[1].items.map((i) => [i.name, i.status]), [["Pizza propia", "extra"]]);
  // Pautado a la cantidad del profesional (150 g); tomado, 200 g + la pizza.
  assert.equal(day.planned.kcal, Math.round(208 * 1.5));
  assert.equal(day.consumed.kcal, 208 * 2 + 270);
  assert.equal(day.extra.kcal, 270);
  assert.equal(day.deviation.kcal, 208 * 2 + 270 - Math.round(208 * 1.5));
  assert.equal(day.deviation.withinTolerance, false);
  assert.deepEqual(day.counts, { planned: 1, eaten: 1, extra: 1 });
  assert.equal(day.completionPercentage, 100);

  // La gráfica de Seguimiento mide igual ese día.
  const tracking = await ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-tracking?from=${date}&to=${date}`);
  assert.equal(Math.round(tracking.dailyTracking[0].planned.kcal), day.planned.kcal);
  assert.equal(Math.round(tracking.dailyTracking[0].consumed.kcal), day.consumed.kcal);
});

test("resumen del día: un día pasado sin menú se mide con el menú por defecto y no se materializa", async () => {
  const { trainer, client } = await setupPair();
  await applyTemplate(trainer, client, await libraryTemplate(trainer), h.day(-3));
  const date = h.day(-2);

  const day = await nutritionDay(trainer, client, date);
  assert.equal(day.state, "unchosen");
  assert.equal(day.menuName, null);
  assert.deepEqual(day.meals.map((m) => [m.name, m.status]), [["Desayuno", "unchecked"], ["Comida", "unchecked"]]);
  assert.deepEqual(day.counts, { planned: 4, eaten: 0, extra: 0 });
  assert.equal(day.completionPercentage, 0);
  assert.equal(await ctx.count("DietDay", { userId: client._id, date }), 0, "un GET no crea el día");

  const pending = await nutritionDay(trainer, client, h.day(1));
  assert.equal(pending.state, "pending");
  assert.deepEqual(pending.meals, []);
  assert.equal((await nutritionDay(trainer, client, h.day(-10))).state, "none");
});

test("resumen del día: fecha inválida 400, y solo lo ve quien lleva la nutrición del cliente", async () => {
  const { trainer, client } = await setupPair();
  const invalid = await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/nutrition-day?date=hoy`);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_DATE");
  assert.equal((await ctx.call(trainer, "GET", `/trainer/clients/${client.id}/nutrition-day`)).status, 400);

  const coach = await ctx.makeTrainer();
  await ctx.relate(coach, client, { scope: "training" });
  assert.equal((await ctx.call(coach, "GET", `/trainer/clients/${client.id}/nutrition-day?date=${h.day(0)}`)).status, 403);
  assert.equal((await ctx.call(client, "GET", `/trainer/clients/${client.id}/nutrition-day?date=${h.day(0)}`)).status, 403);
});
