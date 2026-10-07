const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Perfil y cuenta: quién puede leer o tocar qué usuario, qué campos son
// intocables desde el cliente y cómo se ve reflejado cada cambio en /auth/me
// (lo que pintan las apps al arrancar).

const ctx = h.setup();

test("editar perfil: los cambios se ven en /auth/me y en el login siguiente", async () => {
  const user = await ctx.makeClient({ fields: { weight: 80, height: 180 } });
  const updated = await ctx.put(user, "/users", { _id: user.id, name: "Renombrado", weight: 77.5, theme: "light", lang: "en" });
  assert.equal(updated.name, "Renombrado");
  const me = await ctx.get(user, "/auth/me");
  assert.equal(me.user.name, "Renombrado");
  assert.equal(me.user.weight, 77.5);
  assert.equal(me.user.theme, "light");
});

test("editar perfil: no se puede escalar privilegios ni tocar sesión, premium u objetivo en uso", async () => {
  const user = await ctx.makeClient();
  const goalId = ctx.oid();
  await ctx.put(user, "/users", {
    _id: user.id,
    roles: ["admin"],
    premium: { entitled: true, plan: "yearly", expiresAt: new Date(Date.now() + 9e9) },
    professionalPremium: { entitled: true, tier: "trainer_unlimited" },
    auth: { sessionId: "robada" },
    hash: null,
    provider: "google",
    appleId: "apple-x",
    goalInUse: goalId,
    "premium.entitled": true,
    $set: { roles: ["admin"] },
  });
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.deepEqual(stored.roles, ["user"]);
  assert.equal(stored.premium?.entitled ?? false, false);
  assert.equal(stored.professionalPremium?.entitled ?? false, false);
  assert.equal(stored.auth.sessionId, user.sessionId, "la sesión no cambia");
  assert.equal(stored.provider, undefined);
  assert.equal(stored.appleId, undefined);
  assert.equal(stored.goalInUse, undefined);
  // Y la sesión sigue viva.
  assert.equal((await ctx.call(user, "GET", "/auth/me")).status, 200);
});

test("editar perfil: la contraseña no se puede escribir en claro por PUT /users", async () => {
  const user = await ctx.makeClient({ password: "Original-1" });
  await ctx.call(user, "PUT", "/users", { _id: user.id, password: "texto-plano" });
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.notEqual(stored.password, "texto-plano");
});

test("editar perfil: el peso es la medida de hoy, la respuesta nunca trae secretos y solo entra lo del perfil", async () => {
  const user = await ctx.makeClient({ password: "Original-1", fields: { weight: 80 } });
  const versionBefore = (await ctx.model("User").findById(user.id).lean()).passwordVersion;
  const res = await ctx.call(user, "PUT", "/users", {
    _id: user.id,
    weight: 78.4,
    trainerSeats: { clientIds: [], lockedUntil: null },
    mediaConsentVersion: 99,
    passwordVersion: 7,
    hiddenRecentFoods: [{ kind: "product" }],
    favorites: { products: [ctx.oid()] },
  });
  assert.equal(res.status, 200);
  for (const secret of ["password", "hash", "auth", "restoreCode", "refreshToken", "passwordVersion"]) {
    assert.equal(secret in res.body, false, `la respuesta no lleva ${secret}`);
  }
  assert.equal(res.body.weight, 78.4);
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.equal("weight" in stored, false, "el usuario no guarda el peso");
  assert.equal(stored.mediaConsentVersion ?? null, null);
  assert.equal(stored.passwordVersion, versionBefore, "la versión de contraseña no se toca");
  assert.equal(stored.trainerSeats?.lockedUntil ?? null, null);
  assert.deepEqual(stored.favorites?.products || [], []);
  const today = await ctx.model("Anthropometry").findOne({ userId: user._id, date: h.day(0) }).lean();
  assert.equal(today.weight, 78.4, "apuntado como medida de hoy");
  assert.equal((await ctx.call(user, "PUT", "/users", { _id: user.id, weight: 5 })).body.code, "INVALID_WEIGHT");
});

test("fin del registro social: solo el perfil, el peso como medida y el objetivo inicial", async () => {
  const user = await ctx.makeClient({ fields: { provider: "google" } });
  const res = await ctx.put(user, "/auth/social/complete", {
    name: "Social", sex: 1, height: 180, birth: "1990-05-05", weight: 81, activity: 1.45, steps: 1, training: 1.5, objetive: 0,
    kcalTotal: 2500, proteinsGTotal: 160, carbohydratesGTotal: 280, fatGTotal: 80,
    password: "plano", appleId: "apple-de-otro", roles: ["admin"], mediaConsentVersion: 99,
  });
  assert.equal(res.user.name, "Social");
  assert.equal(res.user.weight, 81);
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.deepEqual([stored.password ?? null, stored.appleId ?? null, stored.mediaConsentVersion ?? null, stored.roles], [null, null, null, ["user"]]);
  assert.ok(stored.goalInUse, "objetivo inicial creado");
});

test("editar perfil de OTRO usuario: 403 y nada cambia", async () => {
  const victim = await ctx.makeClient({ name: "Victima" });
  const attacker = await ctx.makeClient();
  const res = await ctx.call(attacker, "PUT", "/users", { _id: victim.id, name: "Hackeado" });
  assert.equal(res.status, 403);
  assert.equal((await ctx.model("User").findById(victim.id).lean()).name, "Victima");
  assert.equal((await ctx.call(attacker, "PUT", "/users", { name: "Sin id" })).status, 400);
});

test("admin sí puede editar el perfil de otro usuario", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  const res = await ctx.call(admin, "PUT", "/users", { _id: user.id, name: "PorAdmin" });
  assert.equal(res.status, 200);
  assert.equal((await ctx.model("User").findById(user.id).lean()).name, "PorAdmin");
});

test("desmarcar rutina/entreno en uso con null los quita del perfil", async () => {
  const user = await ctx.makeClient({ fields: { tableInUse: ctx.oid(), workoutInUse: ctx.oid() } });
  await ctx.put(user, "/users", { _id: user.id, tableInUse: null, workoutInUse: null });
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.equal(stored.tableInUse, undefined);
  assert.equal(stored.workoutInUse, undefined);
});

test("favoritos: marcar y quitar productos, recetas y ejercicios; solo lo que existe y se puede ver", async () => {
  const user = await ctx.makeClient();
  const product = await ctx.model("Product").create({ name: "Avena", verified: true });
  const exercise = await ctx.model("Exercise").create({ name: "Sentadilla" });
  const recipe = await ctx.model("Recipe").create({ name: "Mía", userId: user._id, customProducts: [] });

  for (const [kind, id] of [["products", product._id], ["recipes", recipe._id], ["exercises", exercise._id]]) {
    assert.equal((await ctx.call(user, "PUT", `/favorites/${kind}/${id}`)).status, 204);
  }
  const favorites = (await ctx.get(user, "/auth/me")).user.favorites;
  assert.deepEqual(
    [favorites.products, favorites.recipes, favorites.exercises].map((list) => list.map(String)),
    [[String(product._id)], [String(recipe._id)], [String(exercise._id)]]
  );
  for (const [kind, id] of [["products", product._id], ["recipes", recipe._id], ["exercises", exercise._id]]) {
    assert.equal((await ctx.call(user, "DELETE", `/favorites/${kind}/${id}`)).status, 204);
  }
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.favorites, { products: [], recipes: [], exercises: [] });

  // Lo que no existe, un tipo desconocido o un id inválido.
  assert.equal((await ctx.call(user, "PUT", `/favorites/products/${ctx.oid()}`)).status, 404);
  assert.equal((await ctx.call(user, "PUT", `/favorites/diets/${product._id}`)).status, 404);
  assert.equal((await ctx.call(user, "PUT", "/favorites/products/xx")).status, 400);
  // Una receta privada ajena no se marca: las favoritas se listan por id y
  // servirían para leerla.
  const foreign = await ctx.model("Recipe").create({ name: "Privada ajena", userId: ctx.oid(), customProducts: [] });
  assert.equal((await ctx.call(user, "PUT", `/favorites/recipes/${foreign._id}`)).status, 404);
  // Las rutas viejas ya no existen.
  for (const [method, path] of [["PUT", "/users/favProduct"], ["PUT", "/users/favRecipe"], ["PUT", "/products/favProduct"], ["PUT", "/exercises/favorite"], ["PUT", "/exercises/archive"], ["POST", "/users/search/by"]]) {
    assert.equal((await ctx.call(user, method, path, {})).status, 404, `${method} ${path}`);
  }
});

test("verificar contraseña: siempre sobre el usuario del token", async () => {
  const user = await ctx.makeClient({ password: "Correcta-1" });
  assert.deepEqual(await ctx.post(user, "/users/verify-password", { password: "Correcta-1" }), { valid: true });
  assert.equal((await ctx.call(user, "POST", "/users/verify-password", { password: "mala" })).status, 401);
  assert.equal((await ctx.call(user, "POST", "/users/verify-password", {})).status, 400);
  const social = await ctx.makeClient();
  const res = await ctx.call(social, "POST", "/users/verify-password", { password: "x" });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "NO_PASSWORD_SET");
});

test("roles: solo admin los cambia y solo a user/admin (nunca trainer por esta vía)", async () => {
  const admin = await ctx.makeAdmin();
  const user = await ctx.makeClient();
  assert.equal((await ctx.call(user, "PUT", `/users/roles/${user.id}`, { roles: ["admin"] })).status, 403);
  assert.equal((await ctx.call(admin, "PUT", `/users/roles/${user.id}`, { roles: ["trainer"] })).status, 400);
  assert.equal((await ctx.call(admin, "PUT", `/users/roles/${user.id}`, { roles: "admin" })).status, 400);
  const ok = await ctx.put(admin, `/users/roles/${user.id}`, { roles: ["user", "admin"] });
  assert.deepEqual(ok.roles, ["user", "admin"]);
  assert.equal((await ctx.call(admin, "PUT", `/users/roles/${ctx.oid()}`, { roles: ["user"] })).status, 404);
});

test("borrar cuenta: no se puede borrar la de otro; la propia sí y su sesión muere", async () => {
  const user = await ctx.makeClient();
  const other = await ctx.makeClient();
  const forbidden = await ctx.call(other, "DELETE", `/users/${user.id}`);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN");
  assert.ok(await ctx.model("User").exists({ _id: user._id }));

  const ok = await ctx.call(user, "DELETE", `/users/${user.id}`);
  assert.equal(ok.status, 204);
  assert.equal(await ctx.model("User").exists({ _id: user._id }), null);
  assert.equal((await ctx.call(user, "GET", "/auth/me")).status, 401);
});

test("leer el perfil de otro usuario por email no expone sus datos ni su código de verificación", async () => {
  const victim = await ctx.makeClient({ fields: { hash: "424242", weight: 90, birth: "1990-01-01" } });
  const other = await ctx.makeClient();
  const res = await ctx.call(other, "GET", `/users/${encodeURIComponent(victim.email)}`);
  assert.ok(res.status === 403 || res.status === 404 || (res.body && res.body.hash === undefined && res.body.weight === undefined), JSON.stringify(res.body));
});

test("búsqueda global de usuarios solo para admin", async () => {
  const user = await ctx.makeClient();
  assert.equal((await ctx.call(user, "POST", "/users/search", { page: 0, search: "" })).status, 403);
});

test("borrar el código de verificación de OTRA cuenta no está permitido", async () => {
  const victim = await ctx.makeClient({ fields: { hash: "777777" } });
  const attacker = await ctx.makeClient();
  await ctx.call(attacker, "DELETE", `/users/hash/${victim.id}`);
  assert.equal((await ctx.model("User").findById(victim.id).lean()).hash, "777777");
});

test("búsqueda de usuarios (admin): por texto, solo premium y paginada", async () => {
  const admin = await ctx.makeAdmin();
  const tag = `zz${Date.now()}`;
  for (let i = 0; i < 12; i += 1) {
    await ctx.makeClient({ name: `${tag}Nombre${i}`, fields: i < 2 ? { premium: { entitled: true, plan: "m", expiresAt: new Date(Date.now() + 9e8) } } : {} });
  }
  const first = await ctx.post(admin, "/users/search", { page: 0, search: tag });
  assert.equal(first.total, 12);
  assert.equal(first.users.length, 10);
  const second = await ctx.post(admin, "/users/search", { page: 1, search: tag });
  assert.equal(second.users.length, 2);
  const premiumOnly = await ctx.post(admin, "/users/search", { page: 0, search: tag, filters: { premiumOnly: true } });
  assert.equal(premiumOnly.total, 2);
});
