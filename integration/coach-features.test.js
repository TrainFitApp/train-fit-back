const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Funciones del panel del profesional que el cliente ve y responde: hábitos
// (y su cumplimiento), suplementos, registro de dolor y umbrales,
// preferencias de nutrición, notas del cliente y notificaciones. En todas, la
// relación activa es la llave: al terminarla, el cliente deja de ver lo del
// profesional y el profesional deja de poder escribir.

const ctx = h.setup();

async function pair(scope = "both") {
  const trainer = await ctx.makeTrainer({ name: "Coach" });
  const client = await ctx.makeClient();
  if (scope === "both") await ctx.relateBoth(trainer, client);
  else await ctx.relate(trainer, client, { scope });
  return { trainer, client };
}

const notifications = async (user) => {
  const list = await ctx.get(user, user.family === h.FAMILY.trainer ? "/trainer/notifications/mine" : "/notifications/mine");
  return Array.isArray(list) ? list : list.notifications || [];
};

// --- Hábitos ------------------------------------------------------------------------

test("hábitos: validación de alta (tipo, objetivo, rango, unidad)", async () => {
  const { trainer, client } = await pair();
  const path = `/trainer/clients/${client.id}/tasks`;
  for (const body of [
    { type: "yoga", target: 1, unit: "x" },
    { type: "custom", target: 1, unit: "x" },
    { type: "water", target: 0, unit: "l" },
    { type: "water", target: 2 },
    { type: "steps", target: 8000, targetMax: 7000, unit: "pasos" },
  ]) {
    assert.equal((await ctx.call(trainer, "POST", path, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(await ctx.count("TrainerTask", { clientId: client._id }), 0);
});

test("hábitos: el cliente los ve con el nombre del profesional, marca hoy y días pasados, nunca el futuro", async () => {
  const { trainer, client } = await pair();
  const task = await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "steps", target: 8000, targetMax: 10000, unit: "pasos" });
  assert.ok((await notifications(client)).some((n) => n.type === "task_assigned"));

  let mine = await ctx.get(client, "/trainer/tasks/mine");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].label, "Pasos diarios");
  assert.equal(mine[0].trainerName, "Coach Test");
  assert.equal(mine[0].completedToday, false);

  await ctx.post(client, `/trainer/tasks/${task._id}/toggle`, { completed: true });
  mine = await ctx.get(client, "/trainer/tasks/mine");
  assert.equal(mine[0].completedToday, true);

  await ctx.post(client, `/trainer/tasks/${task._id}/toggle`, { completed: true, date: h.day(-2) });
  const past = await ctx.get(client, `/trainer/tasks/mine?date=${h.day(-2)}`);
  assert.equal(past[0].completedToday, true, "el día pasado queda marcado");
  const future = await ctx.call(client, "POST", `/trainer/tasks/${task._id}/toggle`, { completed: true, date: h.day(2) });
  assert.equal(future.status, 400);

  await ctx.post(client, `/trainer/tasks/${task._id}/toggle`, { completed: false });
  assert.equal((await ctx.get(client, "/trainer/tasks/mine"))[0].completedToday, false);
  assert.equal(await ctx.count("TaskCompletion", { taskId: task._id }), 1, "desmarcar borra la marca de hoy, la pasada queda");
});

test("hábitos: un hábito ajeno no se puede marcar; al terminar la relación desaparece y no se puede marcar", async () => {
  const { trainer, client } = await pair("nutrition");
  const task = await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "water", target: 2, unit: "l" });
  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(stranger, "POST", `/trainer/tasks/${task._id}/toggle`, {})).status, 404);

  await ctx.model("TrainerClient").updateMany({ trainerId: trainer._id, clientId: client._id }, { $set: { status: "revoked" } });
  assert.deepEqual(await ctx.get(client, "/trainer/tasks/mine"), []);
  assert.equal((await ctx.call(client, "POST", `/trainer/tasks/${task._id}/toggle`, {})).status, 403);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tasks`, { type: "water", target: 2, unit: "l" })).status, 403);
});

test("hábitos: desactivarlo lo quita de la app del cliente; otro entrenador no puede tocarlo", async () => {
  const { trainer, client } = await pair();
  const other = await ctx.makeTrainer();
  await ctx.relate(other, await ctx.makeClient(), { scope: "training" });
  const task = await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "custom", label: "  Estirar  ", target: 10, unit: "min" });
  assert.equal(task.label, "Estirar");
  assert.equal((await ctx.call(other, "DELETE", `/trainer/clients/${client.id}/tasks/${task._id}`)).status, 403);
  await ctx.del(trainer, `/trainer/clients/${client.id}/tasks/${task._id}`);
  assert.deepEqual(await ctx.get(client, "/trainer/tasks/mine"), []);
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/tasks/${ctx.oid()}`)).status, 404);
});

// --- Suplementos ----------------------------------------------------------------------

test("suplementos: validación (nombre, dosis, fechas, enlace solo http/s)", async () => {
  const { trainer, client } = await pair();
  const path = `/trainer/clients/${client.id}/supplements`;
  assert.equal((await ctx.call(trainer, "POST", path, { dose: "5 g" })).body.code, "SUPPLEMENT_INVALID");
  assert.equal((await ctx.call(trainer, "POST", path, { name: "Creatina" })).body.code, "SUPPLEMENT_INVALID");
  assert.equal((await ctx.call(trainer, "POST", path, { name: "C", dose: "1", startDate: h.day(5), endDate: h.day(1) })).body.code, "SUPPLEMENT_INVALID");
  const created = await ctx.post(trainer, path, { name: "Creatina", dose: "5 g", purchaseUrl: "javascript:alert(1)", timing: "inventado", weekdays: [0, 1, 2, 3, 4, 5, 6, 9] });
  assert.equal(created.purchaseUrl, "", "solo enlaces http/https");
  assert.equal(created.timing, "with_meal", "momento fuera de catálogo cae al por defecto");
  assert.deepEqual(created.weekdays, [], "los 7 días = todos los días");
});

test("suplementos: el cliente ve solo los vigentes en la fecha y de profesionales con relación activa", async () => {
  const { trainer, client } = await pair();
  await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Vitamina D", dose: "2000 UI", startDate: h.day(-10) });
  await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Magnesio", dose: "300 mg", startDate: h.day(3) });
  await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Hierro", dose: "1", startDate: h.day(-20), endDate: h.day(-1) });

  const today = await ctx.get(client, "/supplements/mine");
  assert.deepEqual(today.map((s) => s.name), ["Vitamina D"]);
  const later = await ctx.get(client, `/supplements/mine?date=${h.day(4)}`);
  assert.deepEqual(later.map((s) => s.name).sort(), ["Magnesio", "Vitamina D"]);

  await ctx.model("TrainerClient").updateMany({ clientId: client._id }, { $set: { status: "revoked" } });
  assert.deepEqual(await ctx.get(client, "/supplements/mine"), []);
});

test("suplementos: editar y borrar solo los propios del profesional", async () => {
  const { trainer, client } = await pair();
  const supp = await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Omega 3", dose: "1 cáps" });
  const other = await ctx.makeTrainer();
  await ctx.relate(other, client, { scope: "training", status: "revoked" });
  assert.equal((await ctx.call(other, "PUT", `/trainer/clients/${client.id}/supplements/${supp._id}`, { name: "x", dose: "y" })).status, 403);
  const updated = await ctx.put(trainer, `/trainer/clients/${client.id}/supplements/${supp._id}`, { name: "Omega 3", dose: "2 cáps" });
  assert.equal(updated.dose, "2 cáps");
  assert.equal((await ctx.get(client, "/supplements/mine"))[0].dose, "2 cáps", "el cliente ve el cambio");
  await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/supplements/${supp._id}`);
  assert.deepEqual(await ctx.get(client, "/supplements/mine"), []);
});

// --- Dolor --------------------------------------------------------------------------

test("dolor: el cliente lo apunta por zona y día (sin duplicar), el profesional lo ve con sus umbrales", async () => {
  const { trainer, client } = await pair();
  const catalog = await ctx.get(client, "/pain/catalog");
  const zone = catalog.zones[0];
  assert.equal((await ctx.call(client, "PUT", "/pain/mine", { zone: "Oreja", level: 3 })).body.code, "PAIN_INVALID_ENTRY");
  assert.equal((await ctx.call(client, "PUT", "/pain/mine", { zone, level: catalog.max + 5 })).body.code, "PAIN_INVALID_ENTRY");

  await ctx.put(client, "/pain/mine", { zone, level: 4, note: "  Al girar  " });
  await ctx.put(client, "/pain/mine", { zone, level: 6 });
  const today = await ctx.get(client, "/pain/mine");
  assert.equal(today.entries.length, 1, "una entrada por zona y día");
  assert.equal(today.entries[0].level, 6);

  await ctx.put(trainer, `/trainer/clients/${client.id}/pain/thresholds`, { zone, workLevel: 7, painLevel: 3 });
  const view = await ctx.get(trainer, `/trainer/clients/${client.id}/pain`);
  assert.equal(view.entries.length, 1);
  assert.deepEqual([view.thresholds[0].workLevel, view.thresholds[0].painLevel], [3, 7], "el umbral se ordena (trabajo <= dolor)");

  await ctx.call(client, "DELETE", `/pain/mine?zone=${encodeURIComponent(zone)}`);
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/pain`)).entries.length, 0);
  assert.equal((await ctx.call(client, "DELETE", "/pain/mine")).status, 400);
});

// --- Preferencias de nutrición -----------------------------------------------------

test("preferencias de nutrición: pedirlas avisa al cliente con una notificación", async () => {
  const { trainer, client } = await pair();
  await ctx.post(trainer, `/trainer/clients/${client.id}/nutrition-preferences/request`, {});
  assert.ok((await notifications(client)).some((n) => n.type === "nutrition_preferences_requested"));
});

test("preferencias de nutrición: el profesional las pide (pendiente en el panel del cliente), el cliente responde y él recibe el aviso y las ve", async () => {
  const { trainer, client } = await pair();
  await ctx.post(trainer, `/trainer/clients/${client.id}/nutrition-preferences/request`, {});
  let dashboard = await ctx.get(client, "/coach/dashboard");
  assert.equal(dashboard.nutritionPreferences?.pending, true, JSON.stringify(dashboard).slice(0, 400));

  const bad = await ctx.call(client, "PUT", "/nutrition-preferences", { cooksAtHome: "a veces" });
  assert.equal(bad.status, 400);
  assert.equal((await ctx.call(client, "PUT", "/nutrition-preferences", { dietaryFlags: ["carnivoro"] })).status, 400);
  assert.equal((await ctx.call(client, "PUT", "/nutrition-preferences", { disabledMealSlots: ["Brunch"] })).status, 400);

  await ctx.put(client, "/nutrition-preferences", { allergies: "Frutos secos", cooksAtHome: "sometimes", dietaryFlags: ["vegetarian"] });
  assert.ok((await notifications(trainer)).some((n) => n.type === "nutrition_preferences_updated"));
  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/nutrition-preferences`);
  assert.equal(seen.allergies, "Frutos secos");
  assert.deepEqual(seen.dietaryFlags, ["vegetarian"]);
  dashboard = await ctx.get(client, "/coach/dashboard");
  assert.equal(dashboard.nutritionPreferences?.pending, false, "respondida: ya no está pendiente");
});

// --- Notas del cliente --------------------------------------------------------------

test("notas del cliente: lo que escribe en su entreno le aparece al profesional como no leído hasta marcarlo", async () => {
  const { trainer, client } = await pair("training");
  const ce = await ctx.model("CustomExercise").create({ exercise: (await ctx.model("Exercise").create({ name: "Sentadilla" }))._id, sets: [] });
  const workout = await ctx.model("Workout").create({ name: "Pierna", exercises: [ce._id] });
  const split = await ctx.model("Split").create({ name: "M1", workouts: [workout._id] });
  await ctx.model("Table").create({ name: "R", userId: client._id, assignedByTrainerId: trainer._id, splits: [split._id] });

  await ctx.put(client, `/customexercises/${ce._id}/client-notes`, { clientNotes: "Me molesta la rodilla" });
  const unread = await ctx.get(trainer, `/trainer/clients/${client.id}/client-notes/unread-count`);
  assert.ok(JSON.stringify(unread).match(/[1-9]/), JSON.stringify(unread));
  const list = await ctx.get(trainer, `/trainer/clients/${client.id}/client-notes`);
  assert.ok(JSON.stringify(list).includes("Me molesta la rodilla"));

  await ctx.put(trainer, `/trainer/clients/${client.id}/client-notes/seen`, { seen: true, all: true });
  const after = await ctx.get(trainer, `/trainer/clients/${client.id}/client-notes/unread-count`);
  assert.ok(!JSON.stringify(after).match(/[1-9]/), JSON.stringify(after));
  assert.equal((await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/client-notes/seen`, { seen: "quizá" })).body.code, "NOTES_INVALID_SEEN");
});

// --- Notificaciones -----------------------------------------------------------------

test("notificaciones: contador, marcar una y todas, borrar; nadie toca las de otro", async () => {
  const { trainer, client } = await pair();
  await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "water", target: 2, unit: "l" });
  await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "sleep", target: 8, unit: "h" });
  assert.equal((await ctx.get(client, "/notifications/mine/unread-count")).count, 2);
  const [first] = await notifications(client);
  assert.equal(first.trainer?.name, "Coach");

  const stranger = await ctx.makeClient();
  assert.equal((await ctx.call(stranger, "PATCH", `/notifications/${first._id}/read`)).status, 404);
  assert.equal((await ctx.call(stranger, "DELETE", `/notifications/${first._id}`)).status, 404);
  assert.equal((await ctx.get(client, "/notifications/mine/unread-count")).count, 2);

  await ctx.patch(client, `/notifications/${first._id}/read`);
  assert.equal((await ctx.get(client, "/notifications/mine/unread-count")).count, 1);
  assert.equal((await ctx.get(client, "/notifications/mine?unreadOnly=1")).length, 1);
  await ctx.post(client, "/notifications/mark-all-read");
  assert.equal((await ctx.get(client, "/notifications/mine/unread-count")).count, 0);
  await ctx.del(client, `/notifications/${first._id}`);
  assert.equal((await notifications(client)).length, 1);
  // Las del entrenador no se mezclan con las del cliente.
  assert.equal((await ctx.call(trainer, "GET", "/notifications/mine")).status, 403);
});

// --- Recientes del buscador -------------------------------------------------------------

test("recientes del buscador: ocultar uno lo quita de esa comida, volver a añadirlo lo hace reaparecer", async () => {
  const user = await ctx.makeClient();
  const Product = ctx.model("Product");
  const pan = await Product.create({ name: "Pan integral", verified: true });
  const add = (date) => ctx.post(user, "/dietdays/x", { date, indexMeal: 0, customProduct: { quantity: 50, product: { _id: String(pan._id), name: pan.name } } });
  await add("2026-05-01");
  const recents = async () => (await ctx.get(user, `/diets/${user.id}/recent-products?mealIndex=0`)).map((p) => p.name || p.product?.name);
  assert.ok((await recents()).includes("Pan integral"));

  await ctx.post(user, "/recent-foods/hidden", { mealIndex: 0, kind: "product", ids: [String(pan._id)] });
  assert.ok(!(await recents()).includes("Pan integral"));
  assert.ok(await ctx.model("CustomProduct").exists({ product: pan._id }), "el historial no se borra");

  await new Promise((resolve) => setTimeout(resolve, 1100));
  await add("2026-05-02");
  assert.ok((await recents()).includes("Pan integral"), "añadido después de ocultarlo: vuelve");

  assert.equal((await ctx.call(user, "POST", "/recent-foods/hidden", { mealIndex: 0, kind: "zumo", ids: [String(pan._id)] })).body.code, "RECENT_FOODS_INVALID");
  assert.equal((await ctx.call(user, "POST", "/recent-foods/hidden", { mealIndex: 99, kind: "product", ids: [String(pan._id)] })).status, 400);
});

test("los recientes de comida de OTRO usuario no se pueden leer", async () => {
  const victim = await ctx.makeClient();
  await ctx.post(victim, "/dietdays/x", { date: "2026-05-03", indexMeal: 0, customProduct: { quantity: 10, product: { name: "Secreto del desayuno" } } });
  const snoop = await ctx.makeClient();
  const res = await ctx.call(snoop, "GET", `/diets/${victim.id}/recent-products?mealIndex=0`);
  assert.ok(res.status === 403 || res.status === 404 || !JSON.stringify(res.body).includes("Secreto del desayuno"));
});

test("la nota fijada de la dieta de OTRO usuario no se puede cambiar", async () => {
  const victim = await ctx.makeClient();
  const attacker = await ctx.makeClient();
  await ctx.call(attacker, "PATCH", `/diets/${victim.id}/pinned-note`, { notes: "hackeado" });
  assert.notEqual((await ctx.model("User").findById(victim.id).lean()).dietPinnedNote, "hackeado");
});

test("la nota fijada propia se guarda y se ve en el perfil", async () => {
  const user = await ctx.makeClient();
  await ctx.patch(user, `/diets/${user.id}/pinned-note`, { notes: "Beber 2 l" });
  assert.equal((await ctx.get(user, "/auth/me")).user.dietPinnedNote, "Beber 2 l");
});
