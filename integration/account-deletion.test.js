const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Borrar una cuenta (DELETE /users/:id) tiene que dejar la base de datos sin
// ningún documento que la siga referenciando — datos de salud incluidos
// (dolor, suplementos, medidas, fotos) — y sin romper los datos de los demás.
//
// El primer bloque es un guardarraíl GENÉRICO: recorre todos los modelos
// registrados, busca los campos que apuntan a User y comprueba que el hook
// de borrado de components/users/schema.js los limpia. Si mañana alguien
// añade una colección con `userId` y se olvida de la cascada, este test lo
// dice con el nombre del modelo.

const ctx = h.setup();

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

// Referencias que NO deben arrastrar el documento: son marcas de autoría en
// datos que pertenecen a OTRO usuario (la comida pautada sigue siendo del
// cliente aunque el entrenador ya no exista).
const AUTHORSHIP_ONLY = new Set([
  "assignedByTrainerId",
  "alternativesTrainerId",
  "updatedByTrainerId",
  "requestedBy",
]);

// Colecciones sin limpieza en el hook de borrado de usuario. Cada una sería
// un hueco real: datos personales que sobreviven a la cuenta. Vacío desde
// 2026-10; si alguna vez hay que tolerar una, va aquí con el motivo.
const KNOWN_GAPS = new Map([]);

function userRefPaths(model) {
  const paths = [];
  model.schema.eachPath((path, type) => {
    if (path.includes(".")) return; // subdocumentos (auth.*, trainerSeats.*): son del propio User
    const ref = type.options?.ref || type.caster?.options?.ref;
    const isObjectId = /^objectid$/i.test(type.instance || "") || /^objectid$/i.test(type.caster?.instance || "");
    if (!isObjectId) return;
    if (ref === "User" || USER_FIELD_NAMES.has(path)) paths.push({ path, isArray: type.instance === "Array" });
  });
  return paths.filter(({ path }) => !AUTHORSHIP_ONLY.has(path));
}

function modelsReferencingUsers() {
  return ctx.mongoose
    .modelNames()
    .filter((name) => name !== "User")
    .map((name) => ({ name, model: ctx.mongoose.model(name), paths: userRefPaths(ctx.mongoose.model(name)) }))
    .filter(({ paths }) => paths.length);
}

test("cada colección que referencia a User se limpia al borrar la cuenta", async (t) => {
  await ctx.ready;
  const user = await ctx.makeClient({ name: "Borrable" });
  const bystander = await ctx.makeClient({ name: "Inocente" });
  const models = modelsReferencingUsers();
  assert.ok(models.length > 20, `se esperaban muchas colecciones con referencia a User, hay ${models.length}`);

  // Un documento por colección y campo, insertado en crudo (sin validación):
  // lo que se prueba es la cascada, no el alta. Y otro igual del vecino, que
  // tiene que sobrevivir.
  // Los índices únicos de cada colección exigen valores distintos en sus
  // demás campos: se rellenan con ids sueltos para que el alta crudo no choque.
  const probe = (model, path, value) => {
    const doc = { [path]: value, __cascadeProbe: path };
    for (const [keys, options] of model.schema.indexes()) {
      if (!options?.unique) continue;
      for (const key of Object.keys(keys)) if (!(key in doc)) doc[key] = new ctx.mongoose.Types.ObjectId();
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
    const gap = KNOWN_GAPS.get(name);
    await t.test(name, gap ? { todo: `HUECO DE CASCADA: ${gap}` } : {}, () => {
      assert.deepEqual(leftovers, [], `${name} conserva documentos del usuario borrado en: ${leftovers.join(", ")}`);
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
  await ctx.post(client, "/dietdays/x", { date: "2026-07-01", indexMeal: 0, customProduct: { quantity: 10, product: { name: "Algo" } } });

  assert.equal((await ctx.call(client, "DELETE", `/users/${client.id}`)).status, 204);

  assert.deepEqual(await ctx.get(trainer, "/trainer/clients"), []);
  assert.equal(await ctx.count("TrainerNote", { clientId: client._id }), 0);
  assert.equal(await ctx.count("TrainerTask", { clientId: client._id }), 0);
  assert.equal(await ctx.count("DietDay", { userId: client._id }), 0);
  assert.equal(await ctx.count("Product", { userId: client._id }), 0);
  // La ficha del entrenador sigue funcionando.
  assert.equal((await ctx.call(trainer, "GET", "/trainer/review-queue/count")).status, 200);
  assert.equal((await ctx.call(trainer, "GET", "/trainer/clients/paginated")).status, 200);
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

  const deleted = await ctx.call(trainer, "DELETE", `/users/${trainer.id}`);
  assert.equal(deleted.status, 204, JSON.stringify(deleted.body));

  const read = await ctx.post(client, "/dietdays/date/x", { date: "2026-07-02" });
  assert.equal(read.dietDay.meals[0].customProducts.length, 1, "lo que comió el cliente sigue en su historial");
  assert.ok(await ctx.model("Table").exists({ _id: routine._id }), "su rutina sigue siendo suya");
  assert.equal((await ctx.call(client, "GET", "/auth/me")).status, 200);
});

test("un entrenador puede borrar su propia cuenta desde Trainers (verificar contraseña + borrar)", async () => {
  const trainer = await ctx.makeTrainer({ password: "Clave-1234" });
  assert.equal((await ctx.call(trainer, "POST", "/users/verify-password", { password: "Clave-1234" })).status, 200);
  assert.equal((await ctx.call(trainer, "DELETE", `/users/${trainer.id}`)).status, 204);
});
