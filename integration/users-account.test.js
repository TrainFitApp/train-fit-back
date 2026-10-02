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

test("activar/parar dieta: alterna dietEnabled y el perfil expone dietInUse coherente", async () => {
  const user = await ctx.makeClient();
  assert.equal((await ctx.get(user, "/auth/me")).user.dietEnabled, true, "por defecto activada");

  await ctx.patch(user, `/users/playstopdiet/${user.id}`, { enabled: false });
  let me = (await ctx.get(user, "/auth/me")).user;
  assert.equal(me.dietEnabled, false);
  assert.equal(me.dietInUse, null, "apps antiguas: sin dieta");

  // Sin cuerpo: alterna respecto al estado actual (gesto de las apps antiguas).
  await ctx.put(user, `/users/playstopdiet/${user.id}/cualquiera`, {});
  me = (await ctx.get(user, "/auth/me")).user;
  assert.equal(me.dietEnabled, true);
  assert.equal(String(me.dietInUse), user.id);

  const other = await ctx.makeClient();
  assert.equal((await ctx.call(other, "PATCH", `/users/playstopdiet/${user.id}`, { enabled: false })).status, 403);
});

test("favoritos de producto: alternar añade y quita, y no se puede tocar los de otro", async () => {
  const user = await ctx.makeClient();
  const productId = String(ctx.oid());
  const added = await ctx.put(user, "/users/favProduct", { idUser: user.id, idProduct: productId });
  assert.equal(added.isFavorite, true);
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.archivedProducts.map(String), [productId]);
  const removed = await ctx.put(user, "/users/favProduct", { idUser: user.id, idProduct: productId });
  assert.equal(removed.isFavorite, false);
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.archivedProducts, []);

  const other = await ctx.makeClient();
  assert.equal((await ctx.call(other, "PUT", "/users/favProduct", { idUser: user.id, idProduct: productId })).status, 403);
  assert.equal((await ctx.call(user, "PUT", "/users/favProduct", { idUser: user.id })).status, 400);
});

test("favoritos de receta: alternar añade y quita; una receta privada ajena no se puede marcar", async () => {
  const user = await ctx.makeClient();
  // Solo se marca como favorita una receta que el usuario puede leer: las
  // favoritas se listan por id y servirían para leer recetas privadas ajenas.
  const foreign = await ctx.model("Recipe").create({ name: "Privada ajena", userId: ctx.oid(), customProducts: [] });
  assert.equal((await ctx.call(user, "PUT", "/users/favRecipe", { idUser: user.id, idRecipe: String(foreign._id) })).status, 404);
  assert.equal((await ctx.call(user, "PUT", "/users/favRecipe", { idUser: user.id, idRecipe: String(ctx.oid()) })).status, 404);

  const recipeId = String((await ctx.model("Recipe").create({ name: "Mía", userId: user._id, customProducts: [] }))._id);
  assert.equal((await ctx.put(user, "/users/favRecipe", { idUser: user.id, idRecipe: recipeId })).isFavorite, true);
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.archivedRecipes.map(String), [recipeId]);
  assert.equal((await ctx.put(user, "/users/favRecipe", { idUser: user.id, idRecipe: recipeId })).isFavorite, false);
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.archivedRecipes, []);
});

test("buscar entre favoritos devuelve SOLO los del usuario que pregunta", async () => {
  // Determinista: solo OTRO usuario tiene un favorito que encaja; el que
  // pregunta no tiene ninguno, así que lo correcto es una lista vacía.
  const Product = ctx.model("Product");
  const theirs = await Product.create({ name: "Avena favorita ajena", userId: ctx.oid() });
  const other = await ctx.makeClient();
  await ctx.put(other, "/users/favProduct", { idUser: other.id, idProduct: String(theirs._id) });
  const me = await ctx.makeClient();

  const found = await ctx.post(me, "/users/search/by", { node: "products", nodeArchived: "archivedProducts", search: "avena favorita" });
  assert.deepEqual((Array.isArray(found) ? found : []).map((p) => p.name), []);
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
  const victim = await ctx.makeClient({ fields: { hash: "424242", weight: 90, birth: new Date("1990-01-01") } });
  const other = await ctx.makeClient();
  const res = await ctx.call(other, "GET", `/users/${encodeURIComponent(victim.email)}`);
  assert.ok(res.status === 403 || res.status === 404 || (res.body && res.body.hash === undefined && res.body.weight === undefined), JSON.stringify(res.body));
});

test("listado/búsqueda global de usuarios solo para admin", async () => {
  const user = await ctx.makeClient();
  assert.equal((await ctx.call(user, "POST", "/users/search", { page: 0, search: "" })).status, 403);
  assert.equal((await ctx.call(user, "GET", "/users")).status, 403);
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
