const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Lo que depende del plan del usuario (free / premium / con profesional) y
// lo que se ve en todas las pantallas a la vez: entitlements y anuncios,
// objetivos nutricionales (y el que fija el profesional), ejercicios propios,
// medidas, el webhook de RevenueCat y el mantenimiento/actualización forzosa.

const ctx = h.setup();

const PREMIUM = (days = 30) => ({ premium: { entitled: true, plan: "monthly", source: "revenuecat", expiresAt: new Date(Date.now() + days * 86400000) } });

// --- Entitlements y anuncios ------------------------------------------------------------

test("entitlements free: límites, uso real, restantes y anuncios", async () => {
  const user = await ctx.makeClient();
  await ctx.post(user, `/tables/user/${user.id}`, { name: "R" });
  await ctx.post(user, "/nutritionalgoals", { name: "Base", kcalTotal: 2000 });
  const ent = await ctx.get(user, "/billing/entitlements/me");
  assert.equal(ent.isPremium, false);
  assert.deepEqual(ent.limits, { routines: 1, microcyclesPerRoutine: 4, customExercises: 2, recipes: 2, nutritionalGoals: 1 });
  assert.equal(ent.usage.routines, 1);
  assert.equal(ent.usage.nutritionalGoals, 1);
  assert.equal(ent.remaining.routines, 0);
  assert.equal(ent.remaining.customExercises, 2);
  assert.equal(ent.adsEnabled, true);
});

test("entitlements premium: límites infinitos viajan como null y sin anuncios; caducado vuelve a free aunque la BD diga entitled", async () => {
  const premium = await ctx.makeClient({ fields: PREMIUM() });
  const ent = await ctx.get(premium, "/billing/entitlements/me");
  assert.equal(ent.isPremium, true);
  assert.equal(ent.limits.routines, null);
  assert.equal(ent.remaining.recipes, null);
  assert.equal(ent.adsEnabled, false);

  const lapsed = await ctx.makeClient({ fields: PREMIUM(-1) });
  const lapsedEnt = await ctx.get(lapsed, "/billing/entitlements/me");
  assert.equal(lapsedEnt.isPremium, false);
  assert.equal(lapsedEnt.adsEnabled, true);
  assert.equal((await ctx.get(lapsed, "/auth/me")).user.premium.entitled, false, "el perfil tampoco dice premium");
});

test("anuncios: un cliente free con profesional activo no los ve; al terminar la relación vuelven al momento", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "nutrition" });
  assert.equal((await ctx.get(client, "/billing/entitlements/me")).adsEnabled, false);
  await ctx.endRelation(trainer, client);
  assert.equal((await ctx.get(client, "/billing/entitlements/me")).adsEnabled, true);
});

test("webhook de RevenueCat: sin secreto configurado NO debe aceptar eventos de cualquiera", async () => {
  const user = await ctx.makeClient();
  await ctx.raw("POST", "/billing/webhooks/revenuecat", {
    event: { id: `fake-${Date.now()}`, type: "INITIAL_PURCHASE", app_user_id: user.id, product_id: "premium_monthly", expiration_at_ms: Date.now() + 30 * 86400000 },
  });
  assert.notEqual((await ctx.model("User").findById(user.id).lean()).premium?.entitled, true);
});

test("webhook de RevenueCat con secreto: sin cabecera o con otra, 401; con la buena, se aplica una sola vez (idempotente)", async () => {
  const billing = require("../components/billing/billing-service");
  const original = billing.validateWebhookAuth;
  billing.validateWebhookAuth = (req) => (req.headers?.authorization || "") === "Bearer secreto-test";
  try {
    const user = await ctx.makeClient();
    const event = { event: { id: `evt-${Date.now()}`, type: "INITIAL_PURCHASE", app_user_id: user.id, product_id: "premium_monthly", expiration_at_ms: Date.now() + 30 * 86400000 } };
    assert.equal((await ctx.raw("POST", "/billing/webhooks/revenuecat", event)).status, 401);
    assert.equal((await ctx.raw("POST", "/billing/webhooks/revenuecat", event, { authorization: "Bearer otro" })).status, 401);
    const ok = await ctx.raw("POST", "/billing/webhooks/revenuecat", event, { authorization: "Bearer secreto-test" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await ctx.model("User").findById(user.id).lean()).premium.entitled, true);
    const dup = await ctx.raw("POST", "/billing/webhooks/revenuecat", event, { authorization: "Bearer secreto-test" });
    assert.equal(dup.body.duplicated, true);
    // Y la ruta sin /api (compatibilidad) pasa por la misma validación.
    const legacy = await fetch(`${ctx.baseUrl.replace(/\/api$/, "")}/billing/webhooks/revenuecat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(legacy.status, 401);
  } finally {
    billing.validateWebhookAuth = original;
  }
});

// --- Objetivos nutricionales -------------------------------------------------------------

test("objetivos: el primero queda en uso; free solo 1; premium varios y puede cambiar el activo", async () => {
  const free = await ctx.makeClient();
  const goal = await ctx.post(free, "/nutritionalgoals", { name: "Definición", kcalTotal: 1900, proteinsGTotal: 150 });
  assert.equal(String((await ctx.get(free, "/auth/me")).user.goalInUse), String(goal._id));
  const second = await ctx.call(free, "POST", "/nutritionalgoals", { name: "Otro" });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, "NUTRITIONAL_GOALS_LIMIT_REACHED");

  const premium = await ctx.makeClient({ fields: PREMIUM() });
  const a = await ctx.post(premium, "/nutritionalgoals", { name: "A", kcalTotal: 2000 });
  const b = await ctx.post(premium, "/nutritionalgoals", { name: "B", kcalTotal: 2500 });
  assert.equal(String((await ctx.get(premium, "/auth/me")).user.goalInUse), String(a._id), "crear otro no cambia el activo");
  await ctx.put(premium, `/nutritionalgoals/${b._id}/activate`);
  assert.equal(String((await ctx.get(premium, "/auth/me")).user.goalInUse), String(b._id));
});

test("borrar objetivos: nunca el último (409); borrar el activo pasa el uso al más reciente", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM() });
  const a = await ctx.post(user, "/nutritionalgoals", { name: "A" });
  assert.equal((await ctx.call(user, "DELETE", `/nutritionalgoals/${a._id}`)).body.code, "NUTRITIONAL_GOALS_MINIMUM_ONE");
  const b = await ctx.post(user, "/nutritionalgoals", { name: "B" });
  await ctx.put(user, `/nutritionalgoals/${a._id}/activate`);
  const res = await ctx.del(user, `/nutritionalgoals/${a._id}`);
  assert.equal(String(res.goalInUse), String(b._id));
  assert.equal(String((await ctx.get(user, "/auth/me")).user.goalInUse), String(b._id));
});

test("al caducar premium con varios objetivos, solo el activo sigue accesible (NUTRITIONAL_GOAL_LOCKED)", async () => {
  const user = await ctx.makeClient({ fields: PREMIUM() });
  const a = await ctx.post(user, "/nutritionalgoals", { name: "A" });
  const b = await ctx.post(user, "/nutritionalgoals", { name: "B" });
  await ctx.model("User").updateOne({ _id: user._id }, { $set: { "premium.expiresAt": new Date(Date.now() - 1000) } });
  assert.equal((await ctx.call(user, "GET", `/nutritionalgoals/${a._id}`)).status, 200, "el activo sigue");
  for (const [method, path] of [["GET", `/nutritionalgoals/${b._id}`], ["PUT", `/nutritionalgoals/${b._id}`], ["PUT", `/nutritionalgoals/${b._id}/activate`]]) {
    const res = await ctx.call(user, method, path, { name: "x" });
    assert.equal(res.body.code, "NUTRITIONAL_GOAL_LOCKED", `${method} ${path}`);
  }
});

test("objetivos de otro usuario: 404 en leer, editar, activar y borrar", async () => {
  const owner = await ctx.makeClient({ fields: PREMIUM() });
  const goal = await ctx.post(owner, "/nutritionalgoals", { name: "Privado" });
  await ctx.post(owner, "/nutritionalgoals", { name: "Otro" });
  const other = await ctx.makeClient();
  for (const [method, path] of [["GET", `/nutritionalgoals/${goal._id}`], ["PUT", `/nutritionalgoals/${goal._id}`], ["PUT", `/nutritionalgoals/${goal._id}/activate`], ["DELETE", `/nutritionalgoals/${goal._id}`]]) {
    assert.equal((await ctx.call(other, method, path, { name: "x" })).status, 404, `${method} ${path}`);
  }
  const stored = await ctx.model("User").findById(owner._id).select("nutritionalGoals").lean();
  assert.equal(stored.nutritionalGoals.find((g) => String(g._id) === String(goal._id)).name, "Privado");
});

test("el profesional fija el objetivo a mano: el cliente lo ve en su objetivo en uso y recalcular el perfil ya no lo pisa", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient({ fields: { weight: 80, height: 180, sex: 1, birth: "1990-05-01", activity: 1.375, steps: 1.2, training: 1.2, objetive: 0 } });
  await ctx.relate(trainer, client, { scope: "nutrition" });

  const view = await ctx.get(trainer, `/trainer/clients/${client.id}/nutritional-goal`);
  assert.ok(view.calculated?.target?.kcal > 0, "con biométricos completos se calcula una referencia");

  const manual = await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/nutritional-goal`, { kcalTotal: 2222.4, proteinsGTotal: 160.06, carbohydratesGTotal: 250, fatGTotal: 70 });
  assert.ok([200, 201].includes(manual.status));
  assert.equal(manual.body.source, "manual");
  assert.equal(manual.body.kcalTotal, 2222);
  const me = (await ctx.get(client, "/auth/me")).user;
  const clientGoal = await ctx.get(client, `/nutritionalgoals/${me.goalInUse}`);
  assert.equal(clientGoal.kcalTotal, 2222);

  // El cliente cambia de peso vía cuestionario: el objetivo manual se respeta.
  await ctx.model("TrainerClient").updateMany({ clientId: client._id }, { $set: { intakePending: true } });
  await ctx.post(client, "/trainer/intake", { trainerId: trainer.id, weight: 70 });
  assert.equal((await ctx.get(client, `/nutritionalgoals/${me.goalInUse}`)).kcalTotal, 2222);

  // Volver al calculado lo recalcula con los datos actuales.
  const recalculated = await ctx.put(trainer, `/trainer/clients/${client.id}/nutritional-goal`, { recalculate: true });
  assert.equal(recalculated.source, "calculated");
  assert.notEqual(recalculated.kcalTotal, 2222);
  assert.equal((await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/nutritional-goal`, { kcalTotal: 0 })).status, 400);
});

test("recalcular sin biométricos: 422 MISSING_BIOMETRICS", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "nutrition" });
  const res = await ctx.call(trainer, "PUT", `/trainer/clients/${client.id}/nutritional-goal`, { recalculate: true });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "MISSING_BIOMETRICS");
});

// --- Ejercicios propios -----------------------------------------------------------------

test("ejercicios propios: free 2, el entrenador sin límite; solo el dueño los edita y borra", async () => {
  const user = await ctx.makeClient();
  const e1 = await ctx.post(user, "/exercises", { name: "Mi press", userId: "otro" });
  assert.equal(String(e1.userId), user.id, "el dueño sale del token");
  await ctx.post(user, "/exercises", { name: "Mi remo" });
  const third = await ctx.call(user, "POST", "/exercises", { name: "Tercero" });
  assert.equal(third.status, 403);
  assert.equal(third.body.code, "PREMIUM_LIMIT_EXERCISES");

  const trainer = await ctx.makeTrainer();
  for (let i = 0; i < 3; i += 1) await ctx.post(trainer, "/exercises", { name: `Coach ${i}` });

  const other = await ctx.makeClient();
  assert.equal((await ctx.call(other, "PATCH", `/exercises/${e1._id}`, { name: "Robado" })).status, 403);
  assert.equal((await ctx.call(other, "DELETE", `/exercises/${e1._id}`)).status, 403);
  // Editar no puede cambiar de dueño.
  await ctx.patch(user, `/exercises/${e1._id}`, { name: "Mi press inclinado", userId: other.id });
  const stored = await ctx.model("Exercise").findById(e1._id).lean();
  assert.equal(stored.name, "Mi press inclinado");
  assert.equal(String(stored.userId), user.id);
});

// Decisión 2026-10: borrar un ejercicio que alguna sesión usa no toca el
// historial de nadie. Se retira (deletedAt): sale de búsquedas y favoritos,
// y las sesiones que lo tienen lo siguen mostrando con sus series. Uno que
// nadie usa sí se borra.
test("borrar un ejercicio propio: en uso se retira sin tocar sesiones ni series; sin uso se borra; en una plantilla del entrenador, 409", async () => {
  const user = await ctx.makeClient();
  const exercise = await ctx.post(user, "/exercises", { name: "Para borrar" });
  const workout = await ctx.model("Workout").create({ name: "W", exercises: [{ exercise: exercise._id, sets: [{ reps: 5 }, { reps: 6 }] }] });
  await ctx.call(user, "PUT", `/favorites/exercises/${exercise._id}`);

  assert.equal((await ctx.call(user, "DELETE", `/exercises/${exercise._id}`)).status, 204);
  const stored = await ctx.model("Workout").findById(workout._id).lean();
  assert.equal(stored.exercises.length, 1, "la sesión conserva el ejercicio");
  assert.deepEqual(stored.exercises[0].sets.map((set) => set.reps), [5, 6], "y sus series");
  assert.ok((await ctx.model("Exercise").findById(exercise._id).lean()).deletedAt, "retirado, no borrado");
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.favorites.exercises, []);
  const search = await ctx.post(user, "/exercises/search", { userId: user.id, search: "Para borrar" });
  assert.ok(!JSON.stringify(search).includes("Para borrar"), "ya no sale en la búsqueda");

  const unused = await ctx.post(user, "/exercises", { name: "Sin uso" });
  assert.equal((await ctx.call(user, "DELETE", `/exercises/${unused._id}`)).status, 204);
  assert.equal(await ctx.count("Exercise", { _id: unused._id }), 0);

  const trainer = await ctx.makeTrainer();
  const coachExercise = await ctx.post(trainer, "/exercises", { name: "En plantilla" });
  await ctx.post(trainer, "/trainer/workout-templates", { name: "Tpl", blocks: [{ exercises: [{ exercise: coachExercise._id, sets: [{}] }] }] });
  const inUse = await ctx.call(trainer, "DELETE", `/exercises/${coachExercise._id}`);
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.code, "EXERCISE_IN_USE");
});

// --- Medidas ---------------------------------------------------------------------------

test("medidas propias: upsert por fecha (una por día), lista y rango solo del usuario", async () => {
  const user = await ctx.makeClient();
  await ctx.post(user, "/anthropometry/upsert", { date: "2026-03-01", weight: 80, waist: 90 });
  await ctx.post(user, "/anthropometry/upsert", { date: "2026-03-01", weight: 79.6 });
  const all = await ctx.get(user, "/anthropometry");
  assert.equal(all.length, 1);
  assert.equal(all[0].weight, 79.6);
  assert.equal(all[0].waist, 90, "un upsert parcial no borra lo demás");

  const other = await ctx.makeClient();
  await ctx.post(other, "/anthropometry/upsert", { date: "2026-03-02", weight: 60 });
  const range = await ctx.post(user, "/anthropometry/between-dates", { minDate: "2026-03-01", maxDate: "2026-03-31" });
  assert.deepEqual(range.map((a) => a.date), ["2026-03-01"]);
});

test("las medidas de otro usuario no se pueden leer, editar ni borrar por id", async () => {
  const owner = await ctx.makeClient();
  const saved = await ctx.post(owner, "/anthropometry/upsert", { date: "2026-04-01", weight: 70 });
  const attacker = await ctx.makeClient();
  const read = await ctx.call(attacker, "GET", `/anthropometry/${saved._id}`);
  assert.notEqual(read.status, 200);
  await ctx.call(attacker, "PUT", `/anthropometry/${saved._id}`, { weight: 150 });
  await ctx.call(attacker, "DELETE", `/anthropometry/${saved._id}`);
  const stored = await ctx.model("Anthropometry").findById(saved._id).lean();
  assert.ok(stored, "sigue existiendo");
  assert.equal(stored.weight, 70);
});

// --- Mantenimiento y actualización forzosa ----------------------------------------------

test("mantenimiento activo: 503 MAINTENANCE_ACTIVE para las apps, pero config, login y management siguen", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient({ password: "Clave-1234" });
  await ctx.put(admin, "/config/admin", { maintenance: { enabled: true, message: "Volvemos pronto" } });
  try {
    const blocked = await ctx.call(user, "GET", "/auth/me");
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, "MAINTENANCE_ACTIVE");
    assert.equal(blocked.body.message, "Volvemos pronto");

    const publicStatus = await ctx.raw("GET", "/config");
    assert.equal(publicStatus.status, 200);
    assert.equal(publicStatus.body.maintenance.state, "active");
    assert.equal((await ctx.raw("POST", "/auth/login", { email: user.email, password: "Clave-1234" }, { "x-client-family": h.FAMILY.client })).status, 200);
    assert.equal((await ctx.call(admin, "GET", "/config/admin")).status, 200, "la app de management no se bloquea");
  } finally {
    await ctx.put(admin, "/config/admin", { maintenance: { enabled: false } });
  }
  const fresh = await ctx.makeClient();
  assert.equal((await ctx.call(fresh, "GET", "/auth/me")).status, 200);
});

test("mantenimiento programado: aviso antes de empezar, activo durante y se apaga solo al pasar el fin", async () => {
  const admin = await ctx.makeAdmin();
  const now = Date.now();
  try {
    await ctx.put(admin, "/config/admin", { maintenance: { enabled: true, warningFrom: new Date(now - 3600e3), startAt: new Date(now + 3600e3), endAt: new Date(now + 7200e3), warningMessage: "Mañana paramos" } });
    let status = (await ctx.raw("GET", "/config")).body.maintenance;
    assert.equal(status.state, "warning");
    assert.equal(status.message, "Mañana paramos");
    assert.equal((await ctx.call(await ctx.makeClient(), "GET", "/auth/me")).status, 200, "el aviso no bloquea");

    await ctx.put(admin, "/config/admin", { maintenance: { enabled: true, startAt: new Date(now - 7200e3), endAt: new Date(now - 3600e3) } });
    status = (await ctx.raw("GET", "/config")).body.maintenance;
    assert.equal(status.state, "normal", "ventana pasada: se autolimpia aunque enabled siga a true");
  } finally {
    await ctx.put(admin, "/config/admin", { maintenance: { enabled: false } });
  }
});

test("configuración remota: valida coherencia de fechas y versiones; actualización forzosa por plataforma", async () => {
  const admin = await ctx.makeAdmin();
  const now = Date.now();
  const bad = [
    { maintenance: { warningFrom: new Date(now) } },
    { maintenance: { endAt: new Date(now) } },
    { maintenance: { startAt: new Date(now + 1000), endAt: new Date(now) } },
    { maintenance: { startAt: new Date(now), warningFrom: new Date(now + 1000) } },
    { forceUpdate: { minVersionIos: "dos.cero" } },
  ];
  for (const body of bad) {
    const res = await ctx.call(admin, "PUT", "/config/admin", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.errors?.length);
  }
  await ctx.put(admin, "/config/admin", { forceUpdate: { minVersionIos: "2.5.0", minVersionAndroid: "", message: "Actualiza" } });
  const old = await ctx.raw("GET", "/config?version=2.4.9", undefined, { "x-client-platform": "ios" });
  assert.deepEqual(old.body.forceUpdate, { required: true, message: "Actualiza", minVersion: "2.5.0" });
  const current = await ctx.raw("GET", "/config?version=2.5.0", undefined, { "x-client-platform": "ios" });
  assert.equal(current.body.forceUpdate.required, false);
  const android = await ctx.raw("GET", "/config?version=1.0.0", undefined, { "x-client-platform": "android" });
  assert.equal(android.body.forceUpdate.required, false, "sin mínimo para android");
  const garbage = await ctx.raw("GET", "/config?version=banana", undefined, { "x-client-platform": "ios" });
  assert.equal(garbage.body.forceUpdate.required, false, "fail-open con versiones no válidas");
  await ctx.put(admin, "/config/admin", { forceUpdate: { minVersionIos: "" } });
});

// --- Rutas estáticas ------------------------------------------------------------------

test("ayudante de YouTube que sirve la API (/youtube-embed.html y /api/exercises/youtube-embed)", async () => {
  const res = await fetch(`${ctx.baseUrl.replace(/\/api$/, "")}/youtube-embed.html`);
  assert.equal(res.status, 200);
  const user = await ctx.makeClient();
  assert.equal((await ctx.call(user, "GET", "/exercises/youtube-embed")).status, 200);
});
