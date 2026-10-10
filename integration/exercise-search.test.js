const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Búsqueda de ejercicios paginada (POST /exercises/search?withTotal=1): la
// biblioteca del entrenador pide páginas con el total de coincidencias y
// sabe cuándo parar. Sin withTotal sigue el array de siempre, que es lo que
// esperan las apps del cliente ya publicadas.

const ctx = h.setup();

const searchPage = (user, page, body = {}, limit = 10) =>
  ctx.post(user, `/exercises/search?page=${page}&limit=${limit}&withTotal=1`, body);

ctx.before(async () => {
  await ctx.model("Exercise").create(
    Array.from({ length: 23 }, (_, i) => ({ name: `Remo paginado ${String(i).padStart(2, "0")}` }))
  );
  await ctx.model("Exercise").create([{ name: "Sentadilla paginada" }, { name: "Remo retirado", deletedAt: new Date() }]);
});

test("páginas disjuntas con total y hasMore hasta la última", async () => {
  const trainer = await ctx.makeTrainer();
  const seen = [];
  const pages = [];
  for (let page = 0; page < 3; page += 1) {
    const result = await searchPage(trainer, page, { search: "remo paginado" });
    pages.push(result);
    seen.push(...result.items.map((exercise) => String(exercise._id)));
  }

  assert.deepEqual(pages.map((p) => p.total), [23, 23, 23]);
  assert.deepEqual(pages.map((p) => p.items.length), [10, 10, 3]);
  assert.deepEqual(pages.map((p) => p.hasMore), [true, true, false]);
  assert.deepEqual(pages.map((p) => [p.page, p.limit]), [[0, 10], [1, 10], [2, 10]]);
  assert.equal(new Set(seen).size, 23, "ningún ejercicio repetido entre páginas");
});

test("el total cambia con la búsqueda y no cuenta los retirados", async () => {
  const trainer = await ctx.makeTrainer();
  assert.equal((await searchPage(trainer, 0, { search: "sentadilla paginada" })).total, 1);
  assert.equal((await searchPage(trainer, 0, { search: "remo" })).total, 23, "el retirado no sale");
  const none = await searchPage(trainer, 0, { search: "no existe ningun ejercicio asi" });
  assert.deepEqual(none, { items: [], total: 0, page: 0, limit: 10, hasMore: false });
});

test("favoritos sin ninguno marcado: página vacía, no error", async () => {
  const trainer = await ctx.makeTrainer();
  const result = await searchPage(trainer, 0, { favFilter: true, userId: trainer.id });
  assert.deepEqual(result, { items: [], total: 0, page: 0, limit: 10, hasMore: false });
});

test("sin withTotal responde el array de siempre", async () => {
  const user = await ctx.makeClient();
  const list = await ctx.post(user, "/exercises/search?page=0&limit=10", { search: "remo paginado" });
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 10);
});

test("página o límite basura no rompen: primera página, límite acotado", async () => {
  const trainer = await ctx.makeTrainer();
  const result = await ctx.post(trainer, "/exercises/search?page=undefined&limit=9999&withTotal=1", { search: "remo paginado" });
  assert.equal(result.page, 0);
  assert.equal(result.limit, 50);
  assert.equal(result.items.length, 23);
  assert.equal(result.hasMore, false);
});

// QA 2026-10-09: «press banca» ponía «Press banca en multipower» por delante
// de «Press Banca» solo por haberse dado de alta antes.
test("con texto, primero el nombre exacto, luego lo que empieza por él y luego el resto", async () => {
  await ctx.model("Exercise").create([
    { name: "Press banca en multipower" },
    { name: "Press inclinado con barra", keywords: ["press banca"] },
    { name: "Remo con press banca" },
    { name: "Press Banca" },
    { name: "Press de banca agarre cerrado" },
  ]);
  const trainer = await ctx.makeTrainer();
  const result = await searchPage(trainer, 0, { search: "press bánca" });
  assert.deepEqual(
    result.items.map((exercise) => exercise.name),
    [
      "Press Banca",
      "Press banca en multipower",
      "Remo con press banca",
      "Press inclinado con barra",
      "Press de banca agarre cerrado",
    ],
    "exacto, empieza por, contiene, y el resto (palabras clave o sueltas) por largo del nombre"
  );
  assert.equal(result.items[0]._searchRank, undefined, "los campos de orden no salen en la respuesta");
});

test("el orden por relevancia pagina sin repetir ni saltarse ejercicios", async () => {
  const trainer = await ctx.makeTrainer();
  const seen = [];
  for (let page = 0; page < 3; page += 1) {
    seen.push(...(await searchPage(trainer, page, { search: "remo" })).items.map((exercise) => String(exercise._id)));
  }
  assert.equal(seen.length, new Set(seen).size);
});

test("los caracteres especiales se buscan como texto, no rompen la consulta", async () => {
  const trainer = await ctx.makeTrainer();
  for (const search of ["(", "press+", "[banca", "\\", "*"]) {
    const result = await searchPage(trainer, 0, { search });
    assert.ok(Array.isArray(result.items), `«${search}» devuelve una página`);
  }
});
