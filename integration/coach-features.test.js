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

test("hábitos: validación de alta (tipo, objetivo, rango, unidad, topes) con código de error", async () => {
  const { trainer, client } = await pair();
  const path = `/trainer/clients/${client.id}/tasks`;
  for (const [body, code] of [
    [{ type: "yoga", target: 1, unit: "x" }, "TASK_INVALID_TYPE"],
    // El cardio se pauta en el entrenamiento, no es un hábito.
    [{ type: "cardio", target: 30, unit: "min" }, "TASK_INVALID_TYPE"],
    [{ type: "custom", target: 1, unit: "x" }, "TASK_LABEL_REQUIRED"],
    [{ type: "water", target: 0, unit: "l" }, "TASK_INVALID_TARGET"],
    [{ type: "water", target: 2 }, "TASK_UNIT_REQUIRED"],
    [{ type: "water", target: 2, unit: "litros-de-agua-al-dia-x" }, "TASK_UNIT_TOO_LONG"],
    // QA 2026-10-09 (M14): rango invertido y objetivos absurdos.
    [{ type: "steps", target: 8000, targetMax: 7000, unit: "pasos" }, "TASK_INVALID_RANGE"],
    [{ type: "steps", target: 8000, targetMax: 5000, unit: "pasos" }, "TASK_INVALID_RANGE"],
    [{ type: "water", target: 1e12, unit: "L" }, "TASK_TARGET_TOO_HIGH"],
    [{ type: "sleep", target: 30, unit: "h" }, "TASK_TARGET_TOO_HIGH"],
    [{ type: "steps", target: 10000, targetMax: 900000, unit: "pasos" }, "TASK_TARGET_TOO_HIGH"],
  ]) {
    const res = await ctx.call(trainer, "POST", path, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, code, JSON.stringify(body));
  }
  assert.equal(await ctx.count("TrainerTask", { clientId: client._id }), 0);
  // El agua en mililitros admite su escala.
  assert.equal((await ctx.call(trainer, "POST", path, { type: "water", target: 2500, unit: "ml" })).status, 201);
});

test("hábitos: uno activo por tipo (o por nombre si es propio); para cambiar el objetivo se edita", async () => {
  const { trainer, client } = await pair();
  const path = `/trainer/clients/${client.id}/tasks`;
  const steps = await ctx.post(trainer, path, { type: "steps", target: 8000, unit: "pasos" });
  const notices = async () => (await notifications(client)).filter((n) => n.type === "task_assigned").length;
  assert.equal(await notices(), 1);

  const duplicate = await ctx.call(trainer, "POST", path, { type: "steps", target: 10000, unit: "pasos" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "TASK_DUPLICATE");
  assert.equal(duplicate.body.taskId, String(steps._id));
  assert.equal(await notices(), 1, "el duplicado no avisa");

  await ctx.post(trainer, path, { type: "custom", label: "Estirar", target: 10, unit: "min" });
  assert.equal((await ctx.call(trainer, "POST", path, { type: "custom", label: "  estirar ", target: 5, unit: "min" })).body.code, "TASK_DUPLICATE");
  assert.equal((await ctx.call(trainer, "POST", path, { type: "custom", label: "Meditar", target: 5, unit: "min" })).status, 201);

  // Editar: objetivo y rango; el tipo no cambia.
  const edited = await ctx.put(trainer, `${path}/${steps._id}`, { target: 10000, targetMax: 12000, type: "water" });
  assert.deepEqual([edited.type, edited.target, edited.targetMax, edited.unit], ["steps", 10000, 12000, "pasos"]);
  const inverted = await ctx.call(trainer, "PUT", `${path}/${steps._id}`, { targetMax: 5000 });
  assert.equal(inverted.body.code, "TASK_INVALID_RANGE");
  const cleared = await ctx.put(trainer, `${path}/${steps._id}`, { targetMax: null });
  assert.equal(cleared.targetMax, null, "quitar el tope");

  // Quitado, se puede volver a pautar; y ni otro profesional ni el cliente lo editan.
  const other = await ctx.makeTrainer();
  assert.ok([403, 404].includes((await ctx.call(other, "PUT", `${path}/${steps._id}`, { target: 1 })).status));
  assert.equal((await ctx.call(client, "PUT", `${path}/${steps._id}`, { target: 1 })).status, 403);
  await ctx.call(trainer, "DELETE", `${path}/${steps._id}`);
  assert.equal((await ctx.call(trainer, "PUT", `${path}/${steps._id}`, { target: 9000 })).body.code, "TASK_NOT_FOUND");
  assert.equal((await ctx.call(trainer, "POST", path, { type: "steps", target: 9000, unit: "pasos" })).status, 201);
});

test("hábitos de un protocolo: mismos tipos que los sueltos, sin cardio", async () => {
  const trainer = await ctx.makeTrainer({ name: "Coach" });
  const cardio = await ctx.call(trainer, "POST", "/trainer/protocols", {
    name: "Definición",
    dailyTasks: [{ type: "cardio", target: 30, unit: "min" }],
  });
  assert.equal(cardio.status, 400);
  assert.equal(await ctx.count("CoachProtocol", { trainerId: trainer._id }), 0);

  const protocol = await ctx.post(trainer, "/trainer/protocols", {
    name: "Definición",
    dailyTasks: [
      { type: "steps", target: 10000, unit: "pasos" },
      { type: "custom", label: "Cardio", target: 30, unit: "min" },
    ],
  });
  assert.deepEqual(protocol.dailyTasks.map((task) => task.type), ["steps", "custom"]);
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

  await ctx.endRelation(trainer, client);
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
  // QA 2026-10-09 (M15): lo que está fuera de catálogo se rechaza, no se
  // cambia en silencio por otra cosa («todos los días», «con una comida»).
  for (const [body, field] of [
    [{ name: "Creatina", dose: "5 g", weekdays: [9] }, "weekdays"],
    [{ name: "Creatina", dose: "5 g", weekdays: [1, "lunes"] }, "weekdays"],
    [{ name: "Creatina", dose: "5 g", weekdays: "lunes" }, "weekdays"],
    [{ name: "Creatina", dose: "5 g", timing: "bedtime" }, "timing"],
    [{ name: "Creatina", dose: "5 g", startDate: "mañana" }, "startDate"],
    [{ name: "Creatina", dose: "5 g", endDate: "2026-13-45x" }, "endDate"],
  ]) {
    const res = await ctx.call(trainer, "POST", path, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual([res.body.code, res.body.field], ["SUPPLEMENT_INVALID", field], JSON.stringify(body));
  }
  assert.equal(await ctx.count("Supplement", { clientId: client._id }), 0);

  const created = await ctx.post(trainer, path, { name: "Creatina", dose: "5 g", purchaseUrl: "javascript:alert(1)", timing: "before_bed", weekdays: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(created.purchaseUrl, "", "solo enlaces http/https");
  assert.equal(created.timing, "before_bed");
  assert.deepEqual(created.weekdays, [], "los 7 días = todos los días");
  assert.equal((await ctx.post(trainer, path, { name: "Omega 3", dose: "1 g" })).timing, "with_meal", "sin momento, con una comida");
});

test("suplementos: pautar uno avisa al cliente; el duplicado no", async () => {
  const { trainer, client } = await pair();
  const path = `/trainer/clients/${client.id}/supplements`;
  await ctx.post(trainer, path, { name: "Creatina", dose: "5 g" });
  const supplementNotices = async () => (await notifications(client)).filter((n) => n.type === "supplement_assigned");
  const [notice] = await supplementNotices();
  assert.deepEqual(notice.payload, { supplementName: "Creatina" });
  assert.equal((await ctx.call(trainer, "POST", path, { name: "Creatina", dose: "3 g" })).body.code, "SUPPLEMENT_DUPLICATE");
  assert.equal((await supplementNotices()).length, 1);
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

  await ctx.endRelation(trainer, client);
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

test("suplementos propios: sin profesional, el cliente los añade desde un día, los edita y los quita", async () => {
  const client = await ctx.makeClient();
  assert.equal((await ctx.call(client, "POST", "/supplements/mine", { dose: "5 g" })).body.code, "SUPPLEMENT_INVALID");

  const created = await ctx.post(client, "/supplements/mine", {
    name: "  Creatina ",
    dose: "5 g",
    timing: "post_workout",
    startDate: h.day(-2),
    reason: "No lo decide el cliente",
    weekdays: [1],
  });
  assert.equal(created.name, "Creatina");
  assert.equal(created.trainerId, null, "propio: sin profesional");
  assert.equal(created.startDate, h.day(-2));
  assert.deepEqual([created.reason, created.weekdays], ["", []], "solo nombre, dosis y momento");

  const today = await ctx.get(client, "/supplements/mine");
  assert.deepEqual(today.map((s) => [s.name, s.own]), [["Creatina", true]]);
  assert.deepEqual(await ctx.get(client, `/supplements/mine?date=${h.day(-3)}`), [], "antes del día de alta no está");

  const duplicate = await ctx.call(client, "POST", "/supplements/mine", { name: "Creatina", dose: "3 g" });
  assert.deepEqual([duplicate.status, duplicate.body.code], [409, "SUPPLEMENT_DUPLICATE"]);

  const updated = await ctx.put(client, `/supplements/mine/${created._id}`, {
    name: "Creatina",
    dose: "3 g",
    timing: "custom",
    customTiming: "Con el café",
    startDate: h.day(5),
  });
  assert.deepEqual([updated.dose, updated.customTiming], ["3 g", "Con el café"]);
  assert.equal(updated.startDate, h.day(-2), "editar no mueve el día de alta");

  assert.equal((await ctx.call(client, "DELETE", `/supplements/mine/${created._id}`)).status, 204);
  assert.deepEqual(await ctx.get(client, "/supplements/mine"), []);
  const again = await ctx.call(client, "DELETE", `/supplements/mine/${created._id}`);
  assert.deepEqual([again.status, again.body.code], [404, "SUPPLEMENT_NOT_FOUND"]);
});

test("suplementos propios: con profesional activo no se añaden, los que tenía siguen siendo suyos y lo pautado no lo toca", async () => {
  const trainer = await ctx.makeTrainer({ name: "Coach" });
  const client = await ctx.makeClient();
  const own = await ctx.post(client, "/supplements/mine", { name: "Vitamina D", dose: "2000 UI" });
  await ctx.relateBoth(trainer, client);

  const blocked = await ctx.call(client, "POST", "/supplements/mine", { name: "Cafeína", dose: "200 mg" });
  assert.deepEqual([blocked.status, blocked.body.code], [403, "SUPPLEMENT_MANAGED_BY_TRAINER"]);

  const prescribed = await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Magnesio", dose: "300 mg" });
  const list = await ctx.get(client, "/supplements/mine");
  assert.deepEqual(
    list.map((s) => [s.name, s.own, Boolean(s.trainerName)]),
    [["Magnesio", false, true], ["Vitamina D", true, false]],
    "lo pautado primero, distinguido de lo suyo"
  );

  // Cada uno solo toca lo suyo.
  const trainerList = await ctx.get(trainer, `/trainer/clients/${client.id}/supplements`);
  assert.deepEqual(trainerList.map((s) => s.name), ["Magnesio"], "el profesional no ve los propios del cliente");
  assert.equal((await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/supplements/${own._id}`, { name: "x", dose: "y" })).status, 404);
  await ctx.call(trainer, "DELETE", `/trainer/clients/${client.id}/supplements/${own._id}`);
  assert.equal(await ctx.count("Supplement", { _id: own._id }), 1);

  assert.equal((await ctx.call(client, "PUT", `/supplements/mine/${prescribed._id}`, { name: "Magnesio", dose: "1 g" })).status, 404);
  assert.equal((await ctx.call(client, "DELETE", `/supplements/mine/${prescribed._id}`)).status, 404);
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/supplements`))[0].dose, "300 mg");

  const edited = await ctx.put(client, `/supplements/mine/${own._id}`, { name: "Vitamina D", dose: "4000 UI" });
  assert.equal(edited.dose, "4000 UI", "lo suyo lo sigue editando con profesional");

  await ctx.endRelation(trainer, client);
  assert.deepEqual((await ctx.get(client, "/supplements/mine")).map((s) => s.name), ["Vitamina D"]);
  await ctx.post(client, "/supplements/mine", { name: "Cafeína", dose: "200 mg" });
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

test("dolor: cada profesional tiene su umbral por zona (sin duplicar), y se borra sin tocar el del otro", async () => {
  const { trainer, client } = await pair("training");
  const other = await ctx.makeTrainer({ name: "Fisio" });
  await ctx.relate(other, client, { scope: "nutrition" });
  const zone = (await ctx.get(client, "/pain/catalog")).zones[0];

  await ctx.put(trainer, `/trainer/clients/${client.id}/pain/thresholds`, { zone, workLevel: 2, painLevel: 5 });
  await ctx.put(trainer, `/trainer/clients/${client.id}/pain/thresholds`, { zone, workLevel: 3, painLevel: 6, note: "Sin saltos" });
  await ctx.put(other, `/trainer/clients/${client.id}/pain/thresholds`, { zone, workLevel: 1, painLevel: 2 });

  const mine = (await ctx.get(trainer, `/trainer/clients/${client.id}/pain`)).thresholds;
  assert.deepEqual(mine.map((t) => [t.zone, t.workLevel, t.painLevel, t.note]), [[zone, 3, 6, "Sin saltos"]], "una por zona: se sustituye");
  assert.equal((await ctx.pairOf(trainer, client)).painThresholds.length, 1, "vive en el par");

  await ctx.del(trainer, `/trainer/clients/${client.id}/pain/thresholds/${encodeURIComponent(zone)}`);
  assert.deepEqual((await ctx.get(trainer, `/trainer/clients/${client.id}/pain`)).thresholds, []);
  assert.equal((await ctx.get(other, `/trainer/clients/${client.id}/pain`)).thresholds.length, 1, "el del otro profesional sigue");
});

// --- Vídeos de técnica asignados a un cliente ---------------------------------------

test("vídeo de técnica asignado: el cliente lo ve en vez del general, se cambia o quita, y borrar el vídeo quita la asignación", async () => {
  const { trainer, client } = await pair("training");
  const Video = ctx.model("TechniqueVideo");
  const exerciseId = ctx.oid();
  const general = await Video.create({ trainerId: trainer._id, title: "General", source: "youtube", externalUrl: "https://www.youtube.com/watch?v=general01", exerciseIds: [exerciseId] });
  const variant = await Video.create({ trainerId: trainer._id, title: "Variante", source: "youtube", externalUrl: "https://www.youtube.com/watch?v=variant01" });
  const path = `/trainer/clients/${client.id}/technique-videos/${exerciseId}`;

  let mine = await ctx.get(client, "/technique-videos/mine");
  assert.equal(mine.byExercise[String(exerciseId)]?.assignedToYou, false, "sin asignación ve el general");

  const set = await ctx.put(trainer, path, { techniqueVideoId: String(variant._id) });
  assert.deepEqual(set.overrides, [{ exerciseId: String(exerciseId), techniqueVideoId: String(variant._id) }]);
  await ctx.put(trainer, path, { techniqueVideoId: String(variant._id) });
  assert.equal((await ctx.pairOf(trainer, client)).techniqueOverrides.length, 1, "uno por ejercicio, dentro del par");
  mine = await ctx.get(client, "/technique-videos/mine");
  assert.equal(mine.byExercise[String(exerciseId)].assignedToYou, true);

  const stranger = await ctx.makeTrainer();
  const foreign = await Video.create({ trainerId: stranger._id, title: "Ajeno", source: "youtube", externalUrl: "https://www.youtube.com/watch?v=foreign01" });
  assert.equal((await ctx.call(trainer, "PUT", path, { techniqueVideoId: String(foreign._id) })).status, 404, "solo vídeos propios");

  await ctx.del(trainer, `/trainer/technique-videos/${variant._id}`);
  assert.deepEqual((await ctx.get(trainer, `/trainer/clients/${client.id}/technique-videos`)).overrides, [], "borrar el vídeo quita la asignación");
  assert.equal((await ctx.get(client, "/technique-videos/mine")).byExercise[String(exerciseId)].assignedToYou, false);

  await ctx.put(trainer, path, { techniqueVideoId: String(general._id) });
  assert.deepEqual((await ctx.put(trainer, path, {})).overrides, [], "sin vídeo = quitar la asignación");
});

test("biblioteca de vídeos de técnica: el enlace se edita, también de YouTube a Vimeo; uno mal formado o un vídeo subido no", async () => {
  const { trainer, client } = await pair("training");
  const exerciseId = String(ctx.oid());
  const created = await ctx.call(trainer, "POST", "/trainer/technique-videos", {
    title: "Sentadilla",
    source: "youtube",
    externalUrl: "  https://youtu.be/abcdefghijk  ",
    exerciseIds: [exerciseId],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id } = created.body.video;
  assert.deepEqual([created.body.video.source, created.body.video.youtubeId, created.body.video.externalUrl], ["youtube", "abcdefghijk", "https://youtu.be/abcdefghijk"]);

  // Manda el enlace: uno de Vimeo con YouTube marcado se guarda como Vimeo.
  const mislabeled = await ctx.post(trainer, "/trainer/technique-videos", { title: "Peso muerto", source: "youtube", externalUrl: "https://vimeo.com/123456789" });
  assert.deepEqual([mislabeled.video.source, mislabeled.video.vimeoId, mislabeled.video.youtubeId], ["vimeo", "123456789", null]);

  const toVimeo = await ctx.put(trainer, `/trainer/technique-videos/${id}`, { externalUrl: "https://vimeo.com/987654321" });
  assert.deepEqual(
    [toVimeo.video.source, toVimeo.video.vimeoId, toVimeo.video.youtubeId, toVimeo.video.title],
    ["vimeo", "987654321", null, "Sentadilla"],
    "la plataforma sale del enlace y lo demás no cambia"
  );
  const mine = await ctx.get(client, "/technique-videos/mine");
  assert.equal(mine.byExercise[exerciseId].vimeoId, "987654321", "el cliente ve el enlace nuevo");

  const shorts = await ctx.put(trainer, `/trainer/technique-videos/${id}`, { externalUrl: "https://www.youtube.com/shorts/zyxwvutsrqp" });
  assert.deepEqual([shorts.video.source, shorts.video.youtubeId, shorts.video.vimeoId], ["youtube", "zyxwvutsrqp", null]);

  for (const externalUrl of ["https://www.instagram.com/p/abc/", "   ", `https://youtu.be/abcdefghijk?x=${"a".repeat(500)}`]) {
    const bad = await ctx.call(trainer, "PUT", `/trainer/technique-videos/${id}`, { externalUrl });
    assert.equal(bad.status, 400, externalUrl.slice(0, 40));
    assert.equal(bad.body.code, "TECHNIQUE_VIDEO_BAD_URL");
  }
  const renamed = await ctx.put(trainer, `/trainer/technique-videos/${id}`, { title: "Sentadilla goblet" });
  assert.deepEqual([renamed.video.title, renamed.video.youtubeId], ["Sentadilla goblet", "zyxwvutsrqp"], "sin enlace en el cuerpo, el enlace no cambia");

  const uploaded = await ctx.model("TechniqueVideo").create({ trainerId: trainer._id, title: "Subido", source: "upload", assetId: ctx.oid() });
  const noLink = await ctx.call(trainer, "PUT", `/trainer/technique-videos/${uploaded._id}`, { externalUrl: "https://youtu.be/abcdefghijk" });
  assert.equal(noLink.status, 400);
  assert.equal(noLink.body.code, "TECHNIQUE_VIDEO_BAD_SOURCE", "un vídeo subido no pasa a enlace: se borra y se crea otro");
  assert.equal((await ctx.model("TechniqueVideo").findById(uploaded._id).lean()).source, "upload");

  const stranger = await ctx.makeTrainer();
  assert.equal((await ctx.call(stranger, "PUT", `/trainer/technique-videos/${id}`, { externalUrl: "https://vimeo.com/111111111" })).status, 404);
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
  assert.equal(String(seen.clientId), client.id, "misma forma que el documento de la colección antigua");
  assert.equal(seen.favoriteFoods, "", "los campos sin responder llegan con su valor por defecto");
  // Viven dentro del usuario (2026-10), no en una colección aparte.
  const stored = await ctx.model("User").findById(client.id).select("nutritionPreferences").lean();
  assert.equal(stored.nutritionPreferences.cooksAtHome, "sometimes");
  assert.ok(stored.nutritionPreferences.requestedAt, "la solicitud del profesional se conserva al responder");
  dashboard = await ctx.get(client, "/coach/dashboard");
  assert.equal(dashboard.nutritionPreferences?.pending, false, "respondida: ya no está pendiente");
});

// --- Notas del cliente --------------------------------------------------------------

test("notas del cliente: lo que escribe en su entreno le aparece al profesional como no leído hasta marcarlo", async () => {
  const { trainer, client } = await pair("training");
  const exercise = await ctx.model("Exercise").create({ name: "Sentadilla" });
  const { workouts } = await ctx.seedTable({
    owner: client,
    name: "R",
    assignedBy: trainer,
    splits: [{ name: "M1", workouts: [{ name: "Pierna", exercises: [{ exercise: exercise._id, sets: [] }] }] }],
  });
  const ce = workouts[0].exercises[0];

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
  const add = (date) => ctx.post(user, `/dietdays/date/${date}/meals/0/customproducts`, { customProduct: { quantity: 50, product: { _id: String(pan._id), name: pan.name } } });
  await add("2026-05-01");
  const recents = async () => (await ctx.get(user, "/recent-foods/products?mealIndex=0")).map((p) => p.name || p.product?.name);
  assert.ok((await recents()).includes("Pan integral"));

  await ctx.post(user, "/recent-foods/hidden", { mealIndex: 0, kind: "product", ids: [String(pan._id)] });
  assert.ok(!(await recents()).includes("Pan integral"));
  assert.ok(await ctx.model("DietDay").exists({ userId: user._id, "meals.customProducts.product": pan._id }), "el historial no se borra");

  await new Promise((resolve) => setTimeout(resolve, 1100));
  await add("2026-05-02");
  assert.ok((await recents()).includes("Pan integral"), "añadido después de ocultarlo: vuelve");

  assert.equal((await ctx.call(user, "POST", "/recent-foods/hidden", { mealIndex: 0, kind: "zumo", ids: [String(pan._id)] })).body.code, "RECENT_FOODS_INVALID");
  assert.equal((await ctx.call(user, "POST", "/recent-foods/hidden", { mealIndex: 99, kind: "product", ids: [String(pan._id)] })).status, 400);
});

test("los recientes de comida de OTRO usuario no se pueden leer", async () => {
  const victim = await ctx.makeClient();
  await ctx.post(victim, `/dietdays/date/2026-05-03/meals/0/customproducts`, { customProduct: { quantity: 10, product: { name: "Secreto del desayuno" } } });
  const snoop = await ctx.makeClient();
  const res = await ctx.call(snoop, "GET", `/recent-foods/products?mealIndex=0&userId=${victim.id}`);
  assert.equal(res.status, 403);
});

test("la nota fijada de la dieta es siempre la del usuario del token", async () => {
  const victim = await ctx.makeClient();
  const attacker = await ctx.makeClient();
  await ctx.call(attacker, "PUT", "/dietdays/pinned-note", { userId: victim.id, notes: "hackeado" });
  assert.notEqual((await ctx.model("User").findById(victim.id).lean()).dietPinnedNote, "hackeado");
});

test("la nota fijada propia se guarda, se ve en el perfil y en blanco se borra", async () => {
  const user = await ctx.makeClient();
  assert.deepEqual(await ctx.put(user, "/dietdays/pinned-note", { notes: "  Beber 2 l " }), { pinnedNote: "Beber 2 l" });
  assert.equal((await ctx.get(user, "/auth/me")).user.dietPinnedNote, "Beber 2 l");
  assert.deepEqual(await ctx.put(user, "/dietdays/pinned-note", { notes: "" }), { pinnedNote: "" });
  assert.equal((await ctx.get(user, "/auth/me")).user.dietPinnedNote, undefined);
});
