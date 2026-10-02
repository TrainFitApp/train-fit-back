const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Rutinas que asigna el profesional y sus fases (RoutineAssignment), y las
// plantillas de entreno de su biblioteca. Lo que cambia en la app del
// entrenador tiene que llegar a la del cliente: qué rutina tiene en uso, qué
// ve en "mis rutinas", sus avisos.

const ctx = h.setup();

async function pair() {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training" });
  return { trainer, client };
}

async function assignNew(trainer, client, name = "Rutina del coach") {
  return ctx.post(trainer, `/trainer/clients/${client.id}/tables`, { mode: "new", name });
}

const apply = (trainer, client, table, startDate = h.day(0)) =>
  ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables/${table._id}/apply`, { startDate });

const tableInUse = async (user) => String((await ctx.get(user, "/auth/me")).user.tableInUse || "");
const notificationTypes = async (client) => {
  const list = await ctx.get(client, "/notifications/mine");
  return (Array.isArray(list) ? list : list.notifications || []).map((n) => n.type);
};

test("asignar rutina nueva: queda marcada como del entrenador, NO se activa sola y el cliente recibe aviso", async () => {
  const { trainer, client } = await pair();
  const table = await assignNew(trainer, client);
  assert.equal(String(table.userId), client.id);
  assert.equal(String(table.assignedByTrainerId), trainer.id);
  assert.equal(await tableInUse(client), "", "asignar no activa");
  assert.ok((await notificationTypes(client)).includes("routine_assigned"));
  // Borrador del entrenador: el cliente aún no la ve en "mis rutinas".
  assert.deepEqual((await ctx.get(client, "/tables?own=true")).map((t) => t.name), []);
  // El entrenador sí la ve en la ficha.
  assert.deepEqual((await ctx.get(trainer, `/trainer/clients/${client.id}/tables`)).map((t) => t.name), ["Rutina del coach"]);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "otro" })).status, 400);
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "new" })).status, 400);
});

test("programar la rutina como fase desde hoy: pasa a estar en uso y el cliente la ve", async () => {
  const { trainer, client } = await pair();
  const table = await assignNew(trainer, client);
  const res = await apply(trainer, client, table);
  assert.equal(res.status, 201);
  assert.equal(await tableInUse(client), String(table._id));
  assert.deepEqual((await ctx.get(client, "/tables?own=true")).map((t) => t.name), ["Rutina del coach"]);
  const active = await ctx.get(trainer, `/trainer/clients/${client.id}/routine-assignments/active`);
  assert.equal(active.tableName, "Rutina del coach");
  assert.equal(active.status, "active");
});

test("fase futura: no cambia la rutina en uso hasta su fecha; otra fase anterior a ella da ROUTINE_OVERLAP", async () => {
  const { trainer, client } = await pair();
  const current = await assignNew(trainer, client, "Actual");
  const future = await assignNew(trainer, client, "Futura");
  await apply(trainer, client, current, h.day(-7));
  assert.equal((await apply(trainer, client, future, h.day(7))).status, 201);
  assert.equal(await tableInUse(client), String(current._id));

  const third = await assignNew(trainer, client, "Intermedia");
  const clash = await apply(trainer, client, third, h.day(3));
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, "ROUTINE_OVERLAP");
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables/${third._id}/apply`, { startDate: "luego" })).status, 400);
});

test("cuando llega la fecha de una fase programada, el CLIENTE pasa a tener esa rutina en uso (sin que el entrenador abra su ficha)", async () => {
  const { trainer, client } = await pair();
  const current = await assignNew(trainer, client, "Actual");
  const next = await assignNew(trainer, client, "Siguiente");
  await apply(trainer, client, current, h.day(-7));
  await apply(trainer, client, next, h.day(5));
  // Pasa el tiempo: la fase siguiente empieza hoy.
  await ctx.model("RoutineAssignment").updateOne({ tableId: next._id }, { $set: { startDate: h.day(0) } });
  assert.equal(await tableInUse(client), String(next._id));
});

test("el entrenador al abrir la ficha sí sincroniza la fase que empieza hoy", async () => {
  const { trainer, client } = await pair();
  const current = await assignNew(trainer, client, "Actual");
  const next = await assignNew(trainer, client, "Siguiente");
  await apply(trainer, client, current, h.day(-7));
  await apply(trainer, client, next, h.day(5));
  await ctx.model("RoutineAssignment").updateOne({ tableId: next._id }, { $set: { startDate: h.day(0) } });
  const tables = await ctx.get(trainer, `/trainer/clients/${client.id}/tables`);
  assert.equal(tables.find((t) => t.isActive)?.name, "Siguiente");
  assert.equal(await tableInUse(client), String(next._id));
});

test("quitar la fase vigente devuelve al cliente la rutina de la fase anterior; quitar la única la deja sin rutina en uso", async () => {
  const { trainer, client } = await pair();
  const first = await assignNew(trainer, client, "Primera");
  const second = await assignNew(trainer, client, "Segunda");
  const a1 = (await apply(trainer, client, first, h.day(-10))).body;
  const a2 = (await apply(trainer, client, second, h.day(0))).body;
  assert.equal(await tableInUse(client), String(second._id));

  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/routine-assignments/${a2._id}`)).status, 204);
  assert.equal(await tableInUse(client), String(first._id), "vuelve la anterior");
  const active = await ctx.get(trainer, `/trainer/clients/${client.id}/routine-assignments/active`);
  assert.equal(String(active._id), String(a1._id));

  await ctx.del(trainer, `/trainer/clients/${client.id}/routine-assignments/${a1._id}`).catch(() => null);
  assert.equal(await tableInUse(client), "");
  assert.equal(await ctx.get(trainer, `/trainer/clients/${client.id}/routine-assignments/active`), null);
  assert.equal((await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/routine-assignments/${a1._id}`)).status, 404);
});

test("reprogramar una fase futura: sí; una ya empezada o a una fecha pasada: 400", async () => {
  const { trainer, client } = await pair();
  const started = (await apply(trainer, client, await assignNew(trainer, client, "Empezada"), h.day(-1))).body;
  const future = (await apply(trainer, client, await assignNew(trainer, client, "Futura"), h.day(10))).body;
  const moved = await ctx.patch(trainer, `/trainer/clients/${client.id}/routine-assignments/${future._id}`, { startDate: h.day(14) });
  assert.ok(moved);
  assert.equal((await ctx.model("RoutineAssignment").findById(future._id).lean()).startDate, h.day(14));
  const alreadyStarted = await ctx.call(trainer, "PATCH", `/trainer/clients/${client.id}/routine-assignments/${started._id}`, { startDate: h.day(20) });
  assert.equal(alreadyStarted.body.code, "ROUTINE_PHASE_ALREADY_STARTED");
  const past = await ctx.call(trainer, "PATCH", `/trainer/clients/${client.id}/routine-assignments/${future._id}`, { startDate: h.day(-3) });
  assert.equal(past.body.code, "ROUTINE_START_IN_PAST");
});

test("borrar la rutina de una fase vigente (desde la ficha) arrastra sus fases y reconcilia la rutina en uso", async () => {
  const { trainer, client } = await pair();
  const keep = await assignNew(trainer, client, "Se queda");
  const drop = await assignNew(trainer, client, "Se borra");
  await apply(trainer, client, keep, h.day(-10));
  await apply(trainer, client, drop, h.day(0));
  assert.equal((await ctx.call(trainer, "DELETE", `/tables/${client.id}/${drop._id}`)).status, 204);
  assert.equal(await ctx.count("RoutineAssignment", { tableId: drop._id }), 0);
  assert.equal(await tableInUse(client), String(keep._id));
});

test("la rutina de otra fase no se puede programar para un cliente distinto (404)", async () => {
  const { trainer, client } = await pair();
  const other = await ctx.makeClient();
  await ctx.relate(trainer, other, { scope: "training" });
  const othersTable = await assignNew(trainer, other, "De otro");
  assert.equal((await apply(trainer, client, othersTable)).status, 404);
});

test("duplicar plantilla al cliente: pública o propia sí; la rutina de OTRO cliente no", async () => {
  const { trainer, client } = await pair();
  const other = await ctx.makeClient();
  await ctx.relate(trainer, other, { scope: "training" });
  const publicTpl = await ctx.model("Table").create({ name: "Pública TrainFit", splits: [] });
  const ownTpl = await ctx.post(trainer, "/trainer/routines", { name: "Mi plantilla" });
  const othersRoutine = await assignNew(trainer, other, "Privada de otro");

  const fromPublic = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "duplicate", sourceTableId: publicTpl._id });
  assert.equal(fromPublic.status, 201);
  assert.notEqual(String(fromPublic.body._id), String(publicTpl._id));
  const fromOwn = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "duplicate", sourceTableId: ownTpl._id });
  assert.equal(fromOwn.status, 201);
  const fromOther = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "duplicate", sourceTableId: othersRoutine._id });
  assert.ok(fromOther.status >= 400, String(fromOther.status));
  assert.equal((await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/tables`, { mode: "duplicate" })).status, 400);
});

test("las rutinas de la biblioteca del entrenador no cuentan como rutinas de ningún cliente ni le aparecen", async () => {
  const { trainer, client } = await pair();
  await ctx.post(trainer, "/trainer/routines", { name: "Biblioteca 1" });
  await ctx.post(trainer, "/trainer/routines", { name: "Biblioteca 2" });
  const own = await ctx.get(trainer, "/trainer/routines");
  assert.deepEqual(own.map((t) => t.name).sort(), ["Biblioteca 1", "Biblioteca 2"]);
  assert.deepEqual(await ctx.get(client, "/tables?own=true"), []);
});

// --- Plantillas de entreno ------------------------------------------------------------

test("plantilla de entreno aplicada a un microciclo del cliente: copia independiente de la plantilla", async () => {
  const { trainer, client } = await pair();
  const exercise = await ctx.model("Exercise").create({ name: "Press banca" });
  const tpl = await ctx.post(trainer, "/trainer/workout-templates", {
    name: "Empuje",
    level: "experto-inventado",
    tags: ["  pecho ", "", "x".repeat(80)],
    blocks: [{ type: "superset", rounds: "3", exercises: [{ exercise: exercise._id, sets: [{ expectedReps: [8, "10"], expectedRir: [2] }] }] }],
  });
  assert.equal(tpl.level, "intermedio", "nivel fuera de catálogo cae al por defecto");
  assert.equal(tpl.tags[0], "pecho");

  const table = await assignNew(trainer, client);
  const split = await ctx.model("Split").create({ name: "Micro 1", workouts: [] });
  await ctx.model("Table").updateOne({ _id: table._id }, { $push: { splits: split._id } });

  const applied = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/splits/${split._id}/workout-templates/${tpl._id}/apply`);
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const storedSplit = await ctx.model("Split").findById(split._id).lean();
  assert.equal(storedSplit.workouts.length, 1);
  const workout = await ctx.model("Workout").findById(storedSplit.workouts[0]).lean();
  assert.notEqual(String(workout._id), String(tpl._id));
  assert.equal(workout.trainerId ?? null, null, "la copia no es plantilla");

  // Editar la plantilla después no toca lo ya aplicado.
  await ctx.put(trainer, `/trainer/workout-templates/${tpl._id}`, { name: "Empuje v2", blocks: [] });
  assert.equal((await ctx.model("Workout").findById(workout._id).lean()).exercises.length, workout.exercises.length);
  // Y borrarla tampoco.
  await ctx.call(trainer, "DELETE", `/trainer/workout-templates/${tpl._id}`);
  assert.ok(await ctx.model("Workout").exists({ _id: workout._id }));
});

test("aplicar plantilla de entreno a un microciclo que no es de ese cliente: 403/404", async () => {
  const { trainer, client } = await pair();
  const tpl = await ctx.post(trainer, "/trainer/workout-templates", { name: "Pierna" });
  const strangerSplit = await ctx.model("Split").create({ name: "Ajeno", workouts: [] });
  await ctx.model("Table").create({ name: "Ajena", userId: (await ctx.makeClient())._id, splits: [strangerSplit._id] });
  const res = await ctx.call(trainer, "POST", `/trainer/clients/${client.id}/splits/${strangerSplit._id}/workout-templates/${tpl._id}/apply`);
  assert.ok([403, 404].includes(res.status), String(res.status));
  assert.equal((await ctx.model("Split").findById(strangerSplit._id).lean()).workouts.length, 0);
});

test("plantillas de entreno ajenas: invisibles e inmodificables para otro entrenador", async () => {
  const owner = await ctx.makeTrainer();
  const other = await ctx.makeTrainer();
  const tpl = await ctx.post(owner, "/trainer/workout-templates", { name: "Secreta" });
  assert.deepEqual((await ctx.get(other, "/trainer/workout-templates")).map((t) => t.name), []);
  assert.equal((await ctx.call(other, "PUT", `/trainer/workout-templates/${tpl._id}`, { name: "x" })).status, 404);
  assert.equal((await ctx.call(other, "DELETE", `/trainer/workout-templates/${tpl._id}`)).status, 404);
  assert.equal((await ctx.call(owner, "POST", "/trainer/workout-templates", { name: " " })).status, 400);
});
