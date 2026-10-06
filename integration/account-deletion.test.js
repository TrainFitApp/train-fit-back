const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Borrar una cuenta (DELETE /users/:id) tiene que dejar la base de datos sin
// ningún documento que la siga referenciando — datos de salud incluidos
// (dolor, suplementos, medidas, fotos) — y sin romper los datos de los demás.
//
// El primer bloque es un guardarraíl GENÉRICO sobre la cascada declarativa
// (components/util/account-cascade.js): recorre todos los modelos, también
// los que la app aún no monta, busca en cualquier nivel los campos que
// apuntan a un usuario y exige que su schema diga qué hacer con cada uno
// (owners, detach o authorship). Después comprueba que el borrado lo hace.
// Si mañana alguien añade una colección con `userId` y no la declara, este
// test lo dice con el nombre del modelo y del campo.

const ctx = h.setup();
const { declaredModels, loadAllSchemas } = require("../components/util/account-cascade");

// Campos que apuntan a un usuario aunque el schema no declare `ref: "User"`.
const USER_FIELD_NAMES = new Set([
  "userId",
  "clientId",
  "trainerId",
  "ownerId",
  "subjectId",
  "ownerClientId",
  "requestedBy",
  "updatedByTrainerId",
  "authorId",
  "assignedByTrainerId",
  "alternativesTrainerId",
]);

// Todos los caminos (también dentro de subdocumentos y listas) que guardan el
// id de un usuario.
function userRefPaths(schema, prefix = "") {
  const paths = [];
  schema.eachPath((path, type) => {
    const full = prefix + path;
    if (type.schema) {
      paths.push(...userRefPaths(type.schema, `${full}.`).map((ref) => ({ ...ref, nested: true })));
      return;
    }
    const ref = type.options?.ref || type.caster?.options?.ref;
    const isObjectId = /^objectid$/i.test(type.instance || "") || /^objectid$/i.test(type.caster?.instance || "");
    if (!isObjectId) return;
    if (ref === "User" || USER_FIELD_NAMES.has(path.split(".").pop())) {
      paths.push({ path: full, isArray: type.instance === "Array", nested: false });
    }
  });
  return paths;
}

const isAuthorship = (declaration, path) =>
  declaration.authorship.some((entry) => path === entry || path.endsWith(`.${entry}`));

function classify(declaration, path) {
  if (!declaration) return null;
  if (declaration.owners.includes(path)) return "owner";
  if (Object.prototype.hasOwnProperty.call(declaration.detach, path)) return "detach";
  if (isAuthorship(declaration, path)) return "authorship";
  return null;
}

function modelsReferencingUsers() {
  loadAllSchemas();
  const declared = new Map(declaredModels().map(({ name, declaration }) => [name, declaration]));
  return ctx.mongoose
    .modelNames()
    .map((name) => {
      const model = ctx.mongoose.model(name);
      // Un discriminador solo responde de los campos que añade él.
      const base = model.baseModelName ? ctx.mongoose.model(model.baseModelName) : null;
      const inherited = new Set(base ? userRefPaths(base.schema).map(({ path }) => path) : []);
      const paths = userRefPaths(model.schema).filter(({ path }) => !inherited.has(path));
      const declaration = declared.get(name) || null;
      return { name, model, declaration, paths: paths.map((ref) => ({ ...ref, kind: classify(declaration, ref.path) })) };
    })
    .filter(({ paths }) => paths.length);
}

// Documento crudo con `value` en `path` ("auth.impersonatedByUserId" va
// anidado).
function withPath(path, value) {
  const doc = {};
  const keys = path.split(".");
  let cursor = doc;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] = {};
  cursor[keys[keys.length - 1]] = value;
  return doc;
}

test("cada campo que apunta a un usuario está declarado en la cascada de borrado de cuenta", async () => {
  await ctx.ready;
  const undeclared = modelsReferencingUsers().flatMap(({ name, paths }) =>
    paths.filter(({ kind }) => !kind).map(({ path }) => `${name}.${path}`),
  );
  assert.deepEqual(undeclared, [], "declara estos campos con accountCascade (owners, detach o authorship)");
});

test("cada colección que referencia a User se limpia al borrar la cuenta", async (t) => {
  await ctx.ready;
  const user = await ctx.makeClient({ name: "Borrable" });
  const bystander = await ctx.makeClient({ name: "Inocente" });
  const models = modelsReferencingUsers()
    .map((entry) => ({ ...entry, paths: entry.paths.filter(({ kind }) => kind === "owner" || kind === "detach") }))
    .filter(({ paths }) => paths.length);
  assert.ok(models.length > 20, `se esperaban muchas colecciones con referencia a User, hay ${models.length}`);

  // Un documento por colección y campo, insertado en crudo (sin validación):
  // lo que se prueba es la cascada, no el alta. Y otro igual del vecino, que
  // tiene que sobrevivir (o seguir apuntando a él, si es una referencia que
  // se suelta). Los índices únicos de cada colección exigen valores
  // distintos en sus demás campos: se rellenan con ids sueltos para que el
  // alta crudo no choque. Un modelo discriminado (p. ej. WorkoutTemplate en
  // `workouts`) solo ve los documentos de su tipo: la sonda lleva su clave.
  const probe = (model, path, value) => {
    const doc = { ...withPath(path, value), __cascadeProbe: path };
    const mapping = model.schema.discriminatorMapping;
    if (mapping && !mapping.isRoot) doc[mapping.key] = mapping.value;
    for (const [keys, options] of model.schema.indexes()) {
      if (!options?.unique) continue;
      for (const key of Object.keys(keys)) if (!(key.split(".")[0] in doc)) doc[key] = new ctx.mongoose.Types.ObjectId();
    }
    return doc;
  };
  for (const { model, paths } of models) {
    for (const { path, isArray } of paths) {
      await model.collection.insertOne(probe(model, path, isArray ? [user._id] : user._id));
      await model.collection.insertOne(probe(model, path, isArray ? [bystander._id] : bystander._id));
    }
  }

  const res = await ctx.call(user, "DELETE", `/users/${user.id}`);
  assert.equal(res.status, 204, JSON.stringify(res.body));

  for (const { name, model, paths } of models) {
    const leftovers = [];
    for (const { path } of paths) {
      if (await model.collection.countDocuments({ [path]: user._id })) leftovers.push(path);
    }
    await t.test(name, () => {
      assert.deepEqual(leftovers, [], `${name} conserva referencias al usuario borrado en: ${leftovers.join(", ")}`);
    });
    await t.test(`${name} (los del vecino siguen)`, async () => {
      for (const { path } of paths) {
        assert.ok(await model.collection.countDocuments({ [path]: bystander._id }) >= 1, `${name}.${path} del vecino`);
      }
    });
  }
});

// --- Casos realistas -----------------------------------------------------------------

test("borrar la cuenta de un cliente: el entrenador lo pierde de su cartera, sus notas y su bandeja, sin errores", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  await ctx.post(trainer, `/trainer/clients/${client.id}/notes`, { text: "Lesión antigua de hombro" });
  await ctx.post(trainer, `/trainer/clients/${client.id}/tasks`, { type: "water", target: 2, unit: "l" });
  await ctx.post(trainer, `/trainer/clients/${client.id}/supplements`, { name: "Creatina", dose: "5 g" });
  await ctx.put(client, "/pain/mine", { zone: "Cuello", level: 3 });
  await ctx.post(client, `/dietdays/date/2026-07-01/meals/0/customproducts`, { customProduct: { quantity: 10, product: { name: "Algo" } } });

  assert.equal((await ctx.call(client, "DELETE", `/users/${client.id}`)).status, 204);

  assert.deepEqual(await ctx.get(trainer, "/trainer/clients"), []);
  assert.equal(await ctx.count("TrainerNote", { clientId: client._id }), 0);
  assert.equal(await ctx.count("TrainerTask", { clientId: client._id }), 0);
  assert.equal(await ctx.count("DietDay", { userId: client._id }), 0);
  assert.equal(await ctx.count("Product", { userId: client._id }), 0);
  // La ficha del entrenador sigue funcionando.
  assert.equal((await ctx.call(trainer, "GET", "/trainer/review-queue/count")).status, 200);
  assert.equal((await ctx.call(trainer, "GET", "/trainer/roster")).status, 200);
});

test("borrar la cuenta del ENTRENADOR no borra el historial de comidas ni las rutinas de sus clientes", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relateBoth(trainer, client);
  const trainerFood = await ctx.model("Product").create({ name: "Batido del coach", userId: trainer._id, energyKcal100g: 120 });
  const day = await ctx.get(trainer, `/trainer/clients/${client.id}/diet?date=2026-07-02`);
  await ctx.post(trainer, `/trainer/clients/${client.id}/diet-days/2026-07-02/meals/${day.meals[0]._id}/prescribe`, {
    customProducts: [{ product: String(trainerFood._id), quantity: 300, energyKcal100g: 120 }],
    merge: false,
  });
  const routine = await ctx.post(trainer, `/trainer/clients/${client.id}/tables`, { mode: "new", name: "Del coach" });
  // Una fase de dieta en marcha con este cliente y otra programada con otro.
  const running = await ctx.post(trainer, `/trainer/clients/${client.id}/diet-phases`, { name: "En marcha", startDate: h.day(-5), menus: [{ name: "Único", meals: [] }] });
  const otherClient = await ctx.makeClient();
  await ctx.relateBoth(trainer, otherClient);
  const scheduled = await ctx.post(trainer, `/trainer/clients/${otherClient.id}/diet-phases`, { name: "Futura", startDate: h.day(7), menus: [{ name: "Único", meals: [] }] });

  const deleted = await ctx.call(trainer, "DELETE", `/users/${trainer.id}`);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));

  const read = await ctx.post(client, `/dietdays/date/2026-07-02`, {});
  assert.equal(read.dietDay.meals[0].customProducts.length, 1, "lo que comió el cliente sigue en su historial");
  assert.ok(await ctx.model("Table").exists({ _id: routine._id }), "su rutina sigue siendo suya");
  const ended = await ctx.model("DietPhase").findById(running._id).lean();
  assert.deepEqual([ended.trainerId, ended.endDate], [null, h.day(-1)], "la fase en marcha queda como historial terminado ayer");
  assert.equal(await ctx.count("DietPhase", { _id: scheduled._id }), 0, "la que no había empezado se borra");
  assert.equal((await ctx.call(client, "GET", "/auth/me")).status, 200);
});

test("borrar la cuenta conserva sus recetas y ejercicios que otros usan; lo que solo usaba ella se borra", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const [usedRecipe, ownOnlyRecipe, unusedRecipe] = await ctx.model("Recipe").create([
    { name: "En el plato del cliente", userId: trainer._id, customProducts: [] },
    { name: "Solo en su diario", userId: trainer._id, customProducts: [] },
    { name: "Sin usar", userId: trainer._id, customProducts: [] },
  ]);
  const [usedExercise, unusedExercise] = await ctx.model("Exercise").create([
    { name: "Remo del coach", userId: trainer._id },
    { name: "Sin pautar", userId: trainer._id },
  ]);
  await ctx.model("DietDay").collection.insertMany([
    { userId: client._id, date: "2026-07-01", meals: [{ customRecipes: [{ recipe: usedRecipe._id }] }] },
    { userId: trainer._id, date: "2026-07-01", meals: [{ customRecipes: [{ recipe: ownOnlyRecipe._id }] }] },
  ]);
  const session = await ctx.model("Workout").collection.insertOne({ kind: "session", exercises: [{ exercise: usedExercise._id }] });
  await ctx.model("User").updateOne(
    { _id: client._id },
    { $set: { "favorites.recipes": [usedRecipe._id], "favorites.exercises": [usedExercise._id, unusedExercise._id] } },
  );

  assert.equal((await ctx.call(trainer, "DELETE", `/users/${trainer.id}`)).status, 204);

  const orphan = await ctx.model("Recipe").findById(usedRecipe._id).lean();
  assert.deepEqual([orphan.userId, orphan.verified], [undefined, false], "la receta en el plato de otro se queda sin dueño ni verificar");
  assert.equal(await ctx.count("Recipe", { _id: { $in: [ownOnlyRecipe._id, unusedRecipe._id] } }), 0, "su propio diario ya no cuenta como uso");
  const retired = await ctx.model("Exercise").findById(usedExercise._id).lean();
  assert.equal(retired.userId, null);
  assert.ok(retired.deletedAt, "el ejercicio en sesiones de otro se retira");
  assert.equal(await ctx.count("Exercise", { _id: unusedExercise._id }), 0);
  const favorites = (await ctx.model("User").findById(client._id).lean()).favorites;
  assert.deepEqual([favorites.recipes, favorites.exercises], [[], []], "nada de la cuenta borrada queda en favoritos de otros");
  assert.ok(await ctx.model("Workout").collection.findOne({ _id: session.insertedId }), "la sesión del cliente sigue");
});

test("borrar la cuenta del cliente lo saca de las plazas elegidas de su entrenador; borrar al admin cierra sus impersonaciones", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const other = await ctx.makeClient();
  await ctx.model("User").updateOne({ _id: trainer._id }, { $set: { "trainerSeats.clientIds": [client._id, other._id] } });
  assert.equal((await ctx.call(client, "DELETE", `/users/${client.id}`)).status, 204);
  assert.deepEqual((await ctx.model("User").findById(trainer._id).lean()).trainerSeats.clientIds.map(String), [String(other._id)]);

  const admin = await ctx.makeUser({ roles: ["admin"] });
  const impersonated = await ctx.makeClient();
  const response = await ctx.post(admin, "/auth/impersonate", { userId: impersonated.id });
  assert.ok(response.access_token);
  assert.equal(String((await ctx.model("User").findById(impersonated._id).lean()).auth.impersonatedByUserId), String(admin._id));
  assert.equal((await ctx.call(admin, "DELETE", `/users/${admin.id}`)).status, 204);
  assert.equal((await ctx.model("User").findById(impersonated._id).lean()).auth, undefined, "sin admin al que volver, la sesión impersonada se cierra");
});

test("un entrenador puede borrar su propia cuenta desde Trainers (verificar contraseña + borrar)", async () => {
  const trainer = await ctx.makeTrainer({ password: "Clave-1234" });
  assert.equal((await ctx.call(trainer, "POST", "/users/verify-password", { password: "Clave-1234" })).status, 200);
  assert.equal((await ctx.call(trainer, "DELETE", `/users/${trainer.id}`)).status, 204);
});
