const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Catálogo de alimentos y recetas, y el motor de búsqueda único
// (components/util/food-search.js) visto desde sus dos puertas:
// /meals/search y /recipes/search. Lo que se cambia en
// un producto (nombre, marca, borrado, promoción) tiene que reflejarse en la
// búsqueda y en todo lo que lo usaba.

const ctx = h.setup();

const searchFoods = (user, body) => ctx.post(user, "/meals/search", { page: 0, ...body });
const names = (list) => list.map((p) => p.name);

let Product;
let catalogOwner;

ctx.before(async () => {
  Product = ctx.model("Product");
  // Índices reales, los mismos que deja el script de despliegue (sin los de
  // búsqueda la etapa de texto falla en silencio y el rescate no se prueba).
  await require("../scripts/rebuild-indexes").rebuildIndexes(Product.db.db);

  catalogOwner = await ctx.makeClient({ name: "Ajeno" });
  const global = (name, extra = {}) => ({ name, energyKcal100g: 100, verified: true, ...extra });
  await Product.create([
    global("Leche entera", { brand: "Pascual" }),
    global("Leche desnatada", { brand: "Pascual" }),
    global("Dulce de leche"),
    global("Atún claro en aceite", { brand: "Hacendado", code: "8480000123456" }),
    global("Plátano de Canarias"),
    global("Pollo"),
    global("Pollo adobado"),
    global("Pollock fillets"),
    global("Pechuga de pollo asada con especias extra"),
    global("Avena en copos"),
    global("Galleta maría"),
    // Privado de otro usuario: nunca debe salir a nadie más.
    { name: "Leche secreta del vecino", userId: catalogOwner._id, energyKcal100g: 1 },
  ]);
});

// --- Motor de búsqueda -----------------------------------------------------------

test("varias palabras: lo que tiene TODAS va antes que lo que solo tiene alguna (el rescate rellena detrás)", async () => {
  const user = await ctx.makeClient();
  const found = names(await searchFoods(user, { search: "leche entera", userId: user.id }));
  assert.equal(found[0], "Leche entera");
  // Con un catálogo corto la página no se llena y entra el rescate ("leche" a
  // secas), pero siempre por debajo de la coincidencia completa.
  for (const partial of ["Leche desnatada", "Dulce de leche"]) {
    if (found.includes(partial)) assert.ok(found.indexOf(partial) > found.indexOf("Leche entera"), partial);
  }
});

test("varias palabras con catálogo grande: la página se llena solo con coincidencias completas", async () => {
  const user = await ctx.makeClient();
  await Product.create(Array.from({ length: 8 }, (_, i) => ({ name: `Yogur griego natural ${i}`, verified: true })));
  await Product.create(Array.from({ length: 8 }, (_, i) => ({ name: `Yogur de fresa ${i}`, verified: true })));
  const found = names(await searchFoods(user, { search: "yogur griego", userId: user.id }));
  assert.equal(found.length, 7);
  assert.ok(found.every((name) => name.startsWith("Yogur griego")), JSON.stringify(found));
});

test("prefijos parciales por palabra: 'lech ent' sigue encontrando 'Leche entera'", async () => {
  const user = await ctx.makeClient();
  assert.equal(names(await searchFoods(user, { search: "lech ent", userId: user.id }))[0], "Leche entera");
});

test("la búsqueda cruza nombre con marca ('atun hacendado')", async () => {
  const user = await ctx.makeClient();
  assert.deepEqual(names(await searchFoods(user, { search: "atun hacendado", userId: user.id })), ["Atún claro en aceite"]);
});

test("sin tildes ni mayúsculas encuentra igual", async () => {
  const user = await ctx.makeClient();
  for (const query of ["platano", "PLÁTANO", "  Plátano  ", "platano de canarias"]) {
    assert.equal(names(await searchFoods(user, { search: query, userId: user.id }))[0], "Plátano de Canarias", query);
  }
});

test("orden por niveles: nombre exacto > empieza por la palabra > palabra en medio > prefijo de otra palabra", async () => {
  const user = await ctx.makeClient();
  const found = names(await searchFoods(user, { search: "pollo", userId: user.id }));
  assert.deepEqual(found.slice(0, 2), ["Pollo", "Pollo adobado"]);
  assert.ok(found.indexOf("Pechuga de pollo asada con especias extra") < found.indexOf("Pollock fillets"),
    "'pollo' como palabra entera gana a 'Pollock'");
});

test("errata de una letra se rescata ('avenna' encuentra 'Avena en copos')", async () => {
  const user = await ctx.makeClient();
  assert.ok(names(await searchFoods(user, { search: "avenna", userId: user.id })).includes("Avena en copos"));
});

test("plural/stemming se rescata ('galletas' encuentra 'Galleta maría')", async () => {
  const user = await ctx.makeClient();
  assert.ok(names(await searchFoods(user, { search: "galletas", userId: user.id })).includes("Galleta maría"));
});

test("los productos privados de otro usuario NO salen en la búsqueda", async () => {
  const user = await ctx.makeClient();
  assert.ok(!names(await searchFoods(user, { search: "leche", userId: user.id })).includes("Leche secreta del vecino"));
  // Sin texto (listado) tampoco.
  const all = [];
  for (let page = 0; page < 5; page += 1) all.push(...names(await searchFoods(user, { search: "", userId: user.id, page })));
  assert.ok(!all.includes("Leche secreta del vecino"));
});

test("lo propio sale y además gana en el orden a igual nivel", async () => {
  const user = await ctx.makeClient();
  await Product.create({ name: "Leche entera", brand: "Mi granja", userId: user._id, energyKcal100g: 60 });
  const found = await searchFoods(user, { search: "leche entera", userId: user.id });
  assert.equal(String(found[0].userId), user.id, "el propio primero entre dos 'Leche entera'");
  assert.equal(found.filter((p) => p.name === "Leche entera").length, 2);
});

test("un producto ajeno que el usuario ya usa (reciente) o marcó favorito SÍ se puede buscar", async () => {
  const trainer = await ctx.makeTrainer();
  const trainerFood = await Product.create({ name: "Batido del coach", userId: trainer._id, energyKcal100g: 120 });
  const user = await ctx.makeClient();

  assert.equal((await searchFoods(user, { search: "batido coach", userId: user.id })).length, 0, "por defecto no lo ve");
  const asRecent = names(await searchFoods(user, { search: "batido coach", userId: user.id, recentIds: [String(trainerFood._id)] }));
  assert.deepEqual(asRecent, ["Batido del coach"]);

  await ctx.call(user, "PUT", `/favorites/products/${trainerFood._id}`);
  assert.deepEqual(names(await searchFoods(user, { search: "batido coach", userId: user.id })), ["Batido del coach"]);
  // Y en el filtro de favoritos.
  assert.deepEqual(names(await searchFoods(user, { search: "", userId: user.id, favFilter: true })), ["Batido del coach"]);
});

test("recentIds basura o de más se ignoran sin romper la búsqueda", async () => {
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "POST", "/meals/search", {
    search: "leche",
    userId: user.id,
    recentIds: ["no-es-id", { $gt: "" }, ...Array.from({ length: 80 }, () => String(ctx.oid()))],
  });
  assert.equal(res.status, 200);
  assert.ok(names(res.body).includes("Leche entera"));
});

test("el entrenador pautando (userId = cliente) encuentra lo suyo y lo del cliente, no lo de terceros", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  // Solo pauta (y ve lo del cliente) con relación de nutrición activa.
  await ctx.relate(trainer, client, { scope: "nutrition" });
  await Product.create([
    { name: "Tortitas del coach", userId: trainer._id },
    { name: "Tortitas del cliente", userId: client._id },
  ]);
  const found = names(await searchFoods(trainer, { search: "tortitas", userId: client.id }));
  assert.deepEqual(found.sort(), ["Tortitas del cliente", "Tortitas del coach"]);
  // "Solo míos" desde el entrenador: los suyos y los del cliente.
  const own = names(await searchFoods(trainer, { search: "", userId: client.id, ownFilter: true }));
  assert.deepEqual(own.sort(), ["Tortitas del cliente", "Tortitas del coach"]);
});

test("filtro 'solo verificados' y filtro de favoritos vacío", async () => {
  const user = await ctx.makeClient();
  await Product.create({ name: "Leche entera casera", userId: user._id });
  const verified = await searchFoods(user, { search: "leche", userId: user.id, shieldFilter: true });
  assert.ok(verified.every((p) => p.verified === true));
  assert.deepEqual(await searchFoods(user, { search: "leche", userId: user.id, favFilter: true }), []);
  assert.deepEqual(await searchFoods(user, { search: "", ownFilter: true }), [], "propios sin usuario: nada");
});

test("un usuario no puede listar los productos privados de OTRO pasando su userId", async () => {
  const snoop = await ctx.makeClient();
  const found = names(await searchFoods(snoop, { search: "", userId: catalogOwner.id, ownFilter: true }));
  assert.ok(!found.includes("Leche secreta del vecino"));
});

test("paginación estable: páginas disjuntas que juntas son todo el resultado", async () => {
  const user = await ctx.makeClient();
  await Product.create(Array.from({ length: 16 }, (_, i) => ({ name: `Zumo paginado ${String(i).padStart(2, "0")}`, verified: true })));
  const seen = [];
  for (let page = 0; page < 4; page += 1) {
    const chunk = await searchFoods(user, { search: "zumo paginado", userId: user.id, page });
    assert.ok(chunk.length <= 7, "7 por página en search-foods");
    seen.push(...chunk.map((p) => String(p._id)));
  }
  assert.equal(seen.length, 16);
  assert.equal(new Set(seen).size, 16, "ningún producto repetido entre páginas");
});

test("POST /products/search ya no existe: la búsqueda va por /meals/search", async () => {
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "POST", "/products/search", { search: "leche" });
  assert.equal(res.status, 404);
});

// --- Catálogo: crear, editar, borrar, promocionar -----------------------------------

test("crear producto propio: el dueño sale del token aunque el cuerpo diga otro", async () => {
  const user = await ctx.makeClient();
  const created = await ctx.post(user, "/products", { name: "Hummus casero", userId: catalogOwner.id, energyKcal100g: 170 });
  assert.equal(String(created.userId), user.id);
  assert.ok(created.searchTokens.includes("hummus"), "buscable desde el alta");
});

test("un usuario normal no puede crear productos GLOBALES ni verificados", async () => {
  const user = await ctx.makeClient();
  const created = await ctx.post(user, "/products", { name: "Spam global", verified: true });
  assert.equal(String(created.userId), user.id);
  assert.notEqual(created.verified, true);
});

test("renombrar un producto: la búsqueda encuentra el nombre nuevo y ya no el viejo", async () => {
  const user = await ctx.makeClient();
  const created = await ctx.post(user, "/products", { name: "Bizcocho abuela", userId: user.id, energyKcal100g: 350 });
  await ctx.put(user, "/products", { _id: created._id, name: "Magdalena abuela", energyKcal100g: 350, userId: user.id });
  assert.deepEqual(names(await searchFoods(user, { search: "magdalena", userId: user.id })), ["Magdalena abuela"]);
  assert.deepEqual(await searchFoods(user, { search: "bizcocho", userId: user.id }), []);
});

test("editar solo las kcal no deja el producto invisible a la búsqueda (regresión)", async () => {
  const user = await ctx.makeClient();
  const created = await ctx.post(user, "/products", { name: "Queso fresco batido", userId: user.id, energyKcal100g: 50 });
  await ctx.put(user, "/products", { _id: created._id, name: "Queso fresco batido", energyKcal100g: 65, userId: user.id });
  const stored = await Product.findById(created._id).lean();
  assert.equal(stored.energyKcal100g, 65);
  assert.ok(stored.nameNormalized, "nameNormalized se conserva");
  assert.deepEqual(names(await searchFoods(user, { search: "queso fresco", userId: user.id })), ["Queso fresco batido"]);
});

test("editar o borrar un producto ajeno o global: 403; inexistente: 404; admin sí puede", async () => {
  const user = await ctx.makeClient();
  const admin = await ctx.makeAdmin();
  const global = await Product.findOne({ name: "Leche desnatada" });
  const foreign = await Product.findOne({ name: "Leche secreta del vecino" });
  for (const target of [global, foreign]) {
    assert.equal((await ctx.call(user, "PUT", "/products", { _id: target._id, name: "Hack" })).status, 403);
    assert.equal((await ctx.call(user, "DELETE", `/products/${target._id}`)).status, 403);
  }
  assert.equal((await ctx.call(user, "PUT", "/products", { _id: ctx.oid(), name: "x" })).status, 404);
  assert.equal((await ctx.call(user, "DELETE", `/products/${ctx.oid()}`)).status, 404);
  assert.equal((await Product.findById(global._id).lean()).name, "Leche desnatada");

  const adminEdit = await ctx.call(admin, "PUT", "/products", { _id: global._id, name: "Leche desnatada", brand: "Pascual", energyKcal100g: 35, verified: true });
  assert.equal(adminEdit.status, 200);
});

test("biblioteca de alimentos del entrenador: lista lo suyo sin texto, edita lo propio y nada ajeno", async () => {
  const trainer = await ctx.makeTrainer();
  const created = await ctx.post(trainer, "/products", { name: "Crema de cacahuete del coach", energyKcal100g: 600 });
  assert.equal(String(created.userId), trainer.id);

  // La portada de Biblioteca › Alimentos: «Míos» sin texto, productos y recetas.
  const ownProducts = await searchFoods(trainer, { search: "", userId: trainer.id, ownFilter: true });
  assert.deepEqual(names(ownProducts), ["Crema de cacahuete del coach"]);
  await composeRecipe(trainer, "Tostada del coach");
  assert.deepEqual(names(await ctx.get(trainer, "/recipes/search?own=true")), ["Tostada del coach"]);

  const edited = await ctx.call(trainer, "PUT", "/products", { _id: created._id, name: "Crema de cacahuete 100 %", energyKcal100g: 620 });
  assert.equal(edited.status, 200);
  assert.equal((await Product.findById(created._id).lean()).energyKcal100g, 620);
  assert.deepEqual(names(await searchFoods(trainer, { search: "cacahuete", userId: trainer.id })), ["Crema de cacahuete 100 %"]);

  const global = await Product.findOne({ name: "Leche desnatada" });
  const foreign = await Product.findOne({ name: "Leche secreta del vecino" });
  for (const target of [global, foreign]) {
    assert.equal((await ctx.call(trainer, "PUT", "/products", { _id: target._id, name: "Hack" })).status, 403);
  }
  assert.equal((await Product.findById(foreign._id).lean()).name, "Leche secreta del vecino");
});

test("promocionar a global: solo admin; después lo ve todo el mundo como verificado", async () => {
  const owner = await ctx.makeClient();
  const stranger = await ctx.makeClient();
  const admin = await ctx.makeAdmin();
  const created = await ctx.post(owner, "/products", { name: "Kéfir de cabra artesano", userId: owner.id });
  assert.deepEqual(await searchFoods(stranger, { search: "kefir cabra", userId: stranger.id }), []);
  assert.equal((await ctx.call(owner, "PUT", `/products/promote/${created._id}`)).status, 403);
  await ctx.put(admin, `/products/promote/${created._id}`);
  const found = await searchFoods(stranger, { search: "kefir cabra", userId: stranger.id, shieldFilter: true });
  assert.deepEqual(names(found), ["Kéfir de cabra artesano"]);
  assert.equal(found[0].userId ?? null, null);
});

test("código de barras: primero el propio, después el global", async () => {
  const user = await ctx.makeClient();
  const code = "8412345678905";
  await Product.create({ name: "Galletas globales", code });
  let res = await ctx.get(user, `/products/code/${code}`);
  assert.equal(res.product.name, "Galletas globales");
  assert.equal(res.isOwn, false);
  await Product.create({ name: "Mis galletas", code, userId: user._id });
  res = await ctx.get(user, `/products/code/${code}`);
  assert.equal(res.product.name, "Mis galletas");
  assert.equal(res.isOwn, true);
  res = await ctx.get(user, `/products/code/0000000000000`);
  assert.equal(res.product, null);
});

// Decisión 2026-10: borrar un producto no borra historial. Cada alimento que
// lo usaba (diario, recetas, plantillas) se queda como adición rápida con el
// nombre y los valores de ese momento; lo que ya sobrescribía manda.
test("borrar un producto propio: sale de favoritos y donde se usaba queda como adición rápida con sus valores", async () => {
  const user = await ctx.makeClient();
  const created = await ctx.post(user, "/products", { name: "Producto efímero", userId: user.id, energyKcal100g: 10, protein100g: 3 });
  await ctx.call(user, "PUT", `/favorites/products/${created._id}`);
  // En el diario, con un valor propio.
  await ctx.post(user, `/dietdays/date/2026-02-01/meals/0/customproducts`, { customProduct: { quantity: 50, energyKcal100g: 12, product: { _id: String(created._id), name: created.name } } });
  // En una receta y en una plantilla de dieta (arrays anidados, embebidos).
  const pollo = await Product.findOne({ name: "Pollo" });
  const recipe = await ctx.model("Recipe").create({ name: "Receta con efímero", userId: user._id, customProducts: [{ product: created._id, quantity: 20 }] });
  const template = await ctx.model("DietTemplate").create({
    trainerId: ctx.oid(),
    name: "Plantilla con efímero",
    menus: [{ name: "Menú 1", meals: [{ slot: "Desayuno", alternatives: [{ label: "A", customProducts: [{ product: created._id, quantity: 30 }, { product: pollo._id, quantity: 150 }] }] }] }],
  });
  // Y en la fase de dieta de un cliente (contenido versionado dentro).
  const phase = await ctx.model("DietPhase").create({
    clientId: user._id,
    name: "Fase con efímero",
    startDate: "2026-02-01",
    contents: [{ startDate: "2026-02-01", menus: [{ name: "Menú 1", meals: [{ slot: "Cena", alternatives: [{ label: "", customProducts: [{ product: created._id, quantity: 40 }] }] }] }] }],
  });

  assert.equal((await ctx.call(user, "DELETE", `/products/${created._id}`)).status, 204);
  assert.equal(await Product.countDocuments({ _id: created._id }), 0);

  const day = (await ctx.post(user, `/dietdays/date/2026-02-01`, {})).dietDay;
  const kept = day.meals[0].customProducts[0];
  assert.equal(kept.quickAdd, true, "sigue en el diario como adición rápida");
  assert.equal(kept.product ?? null, null);
  assert.equal(kept.name, "Producto efímero");
  assert.equal(kept.energyKcal100g, 12, "lo que ya sobrescribía manda");
  assert.equal(kept.protein100g, 3, "lo demás, del producto en el momento de borrarlo");
  assert.equal(kept.quantity, 50);

  const storedRecipe = await ctx.model("Recipe").findById(recipe._id).lean();
  assert.equal(storedRecipe.customProducts[0].quickAdd, true);
  assert.equal(storedRecipe.customProducts[0].name, "Producto efímero");
  const alternative = (await ctx.model("DietTemplate").findById(template._id).lean()).menus[0].meals[0].alternatives[0];
  assert.equal(alternative.customProducts[0].quickAdd, true);
  assert.equal(String(alternative.customProducts[1].product), String(pollo._id), "lo demás de la plantilla no se toca");
  const inPhase = (await ctx.model("DietPhase").findById(phase._id).lean()).contents[0].menus[0].meals[0].alternatives[0].customProducts[0];
  assert.equal(inPhase.quickAdd, true);
  assert.equal(inPhase.name, "Producto efímero");
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.favorites.products, []);
});

// --- Recetas -----------------------------------------------------------------------

async function composeRecipe(user, name, extra = {}) {
  return ctx.post(user, "/recipes/compose", {
    recipe: { name, customProducts: [{ quantity: 100, energyKcal100g: 200, product: (await Product.findOne({ name: "Avena en copos" }))._id }] },
    ...extra,
  });
}

test("límite free de recetas: 2 propias; la tercera da PREMIUM_LIMIT_RECIPES; premium vigente sin límite; premium caducado vuelve a free", async () => {
  const free = await ctx.makeClient();
  await composeRecipe(free, "Receta uno");
  await composeRecipe(free, "Receta dos");
  const third = await ctx.call(free, "POST", "/recipes/compose", { recipe: { name: "Receta tres", customProducts: [] } });
  assert.equal(third.status, 403);
  assert.equal(third.body.code, "PREMIUM_LIMIT_RECIPES");
  const viaCreate = await ctx.call(free, "POST", "/recipes", { name: "Por la otra vía" });
  assert.equal(viaCreate.status, 403);

  const premium = await ctx.makeClient({ fields: { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() + 86400000) } } });
  for (let i = 0; i < 4; i += 1) await composeRecipe(premium, `Premium ${i}`);

  const expired = await ctx.makeClient({ fields: { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() - 1000) } } });
  await composeRecipe(expired, "Caducada 1");
  await composeRecipe(expired, "Caducada 2");
  assert.equal((await ctx.call(expired, "POST", "/recipes/compose", { recipe: { name: "Caducada 3" } })).status, 403);
});

test("una receta guarda la descripción entera que dejan escribir los editores (20 pasos de 300 caracteres)", async () => {
  const chef = await ctx.makeClient();
  const description = Array.from({ length: 20 }, (_, i) => `${i + 1}. ${"x".repeat(296)}`).join("\n");
  assert.ok(description.length > 2000, "antes el back cortaba en 2.000 y daba error");
  await ctx.post(chef, "/recipes", { name: "Receta larga", description });
  assert.equal((await ctx.model("Recipe").findOne({ name: "Receta larga" }).lean()).description, description);
});

test("el entrenador crea recetas de biblioteca sin límite pero nunca las engancha a una comida", async () => {
  const trainer = await ctx.makeTrainer();
  for (let i = 0; i < 3; i += 1) await composeRecipe(trainer, `Coach receta ${i}`);
  const attach = await ctx.call(trainer, "POST", "/recipes/compose", { recipe: { name: "X" }, context: { mealId: String(ctx.oid()) } });
  assert.equal(attach.status, 403);
});

test("crear y apuntar una receta en una fecha nueva en una sola llamada estrena el día del usuario", async () => {
  const user = await ctx.makeClient();
  const result = await composeRecipe(user, "Gachas", { customRecipe: { quantity: 250 }, context: { indexMeal: 0, currentDate: "2026-02-10", dietInUseId: String(ctx.oid()) } });
  assert.ok(result.dietDay);
  const day = (await ctx.post(user, `/dietdays/date/2026-02-10`, {})).dietDay;
  assert.equal(day.meals[0].customRecipes.length, 1);
  assert.equal(day.meals[0].customRecipes[0].recipe.name, "Gachas");
  assert.equal(await ctx.count("DietDay", { userId: user._id }), 1, "sin día huérfano con otro dueño");
  assert.equal(await ctx.count("DietDay", { userId: { $ne: user._id }, date: "2026-02-10" }), 0);
});

test("buscar recetas: las verificadas las ve todo el mundo; las propias, solo su dueño", async () => {
  const admin = await ctx.makeAdmin({ roles: ["admin", "user"] });
  const owner = await ctx.makeClient();
  const other = await ctx.makeClient();
  const verified = await ctx.post(admin, "/recipes", { name: "Tortilla de patatas", verified: true });
  assert.equal(verified.verified, true);
  assert.equal(verified.userId ?? null, null);
  await composeRecipe(owner, "Tortilla de la abuela");
  const forOwner = names(await ctx.get(owner, "/recipes/search?search=tortilla"));
  const forOther = names(await ctx.get(other, "/recipes/search?search=tortilla"));
  assert.deepEqual(forOwner.sort(), ["Tortilla de la abuela", "Tortilla de patatas"]);
  assert.deepEqual(forOther, ["Tortilla de patatas"]);
});

test("el admin crea recetas verificadas (globales) también desde /recipes/compose", async () => {
  const admin = await ctx.makeAdmin({ roles: ["admin", "user"] });
  const { recipe } = await ctx.post(admin, "/recipes/compose", { recipe: { name: "Verificada por compose", verified: true, customProducts: [] } });
  assert.equal(recipe.verified, true);
  assert.equal(recipe.userId ?? null, null);
});

test("receta favorita: marcar y desmarcar, y verla en la pestaña de favoritas", async () => {
  const user = await ctx.makeClient();
  const recipe = (await composeRecipe(user, "Bowl favorito")).recipe;
  assert.equal((await ctx.call(user, "PUT", `/favorites/recipes/${recipe._id}`)).status, 204);
  assert.equal((await ctx.call(user, "PUT", `/favorites/recipes/${recipe._id}`)).status, 204, "idempotente");
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.favorites.recipes.map(String), [String(recipe._id)]);
  assert.deepEqual(names(await ctx.get(user, "/recipes/search?fav=true")), ["Bowl favorito"]);
  assert.equal((await ctx.call(user, "DELETE", `/favorites/recipes/${recipe._id}`)).status, 204);
  assert.deepEqual(await ctx.get(user, "/recipes/search?fav=true"), []);
});

test("una receta del entrenador marcada como favorita por el cliente sale en sus favoritas", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  // Con relación: un usuario solo marca como favorita una receta que puede
  // leer (si no, las favoritas servirían para leer recetas privadas ajenas).
  await ctx.relate(trainer, client, { scope: "nutrition" });
  const recipe = (await composeRecipe(trainer, "Receta del coach")).recipe;
  await ctx.call(client, "PUT", `/favorites/recipes/${recipe._id}`);
  assert.deepEqual(names(await ctx.get(client, "/recipes/search?fav=true")), ["Receta del coach"]);
});

test("editar receta: solo su dueño (o admin); el cambio de ingredientes se ve en la receta", async () => {
  const owner = await ctx.makeClient();
  const other = await ctx.makeClient();
  const recipe = (await composeRecipe(owner, "Crema de calabaza")).recipe;
  assert.equal((await ctx.call(other, "PUT", `/recipes/${recipe._id}`, { name: "Robada" })).status, 403);
  const updated = await ctx.put(owner, `/recipes/${recipe._id}`, { name: "Crema de calabaza y puerro" });
  assert.equal(updated.name, "Crema de calabaza y puerro");
  assert.deepEqual(names(await ctx.get(owner, "/recipes/search?search=puerro")), ["Crema de calabaza y puerro"]);
  assert.equal((await ctx.call(owner, "PUT", `/recipes/${ctx.oid()}`, { name: "x" })).status, 404);
});

// Decisión 2026-10: una receta que alguien tiene en un plato no se borra:
// queda sin dueño ni verificar (no sale en búsquedas) y esos platos se siguen
// pintando. Sin uso, se borra de verdad.
test("borrar receta: sale de favoritos; usada en el diario se queda sin dueño y el plato sigue; sin uso se borra", async () => {
  const user = await ctx.makeClient({ fields: { premium: { entitled: true, plan: "monthly", expiresAt: new Date(Date.now() + 86400000) } } });
  const { recipe } = await composeRecipe(user, "Receta a borrar", { customRecipe: { quantity: 100 }, context: { indexMeal: 1, currentDate: "2026-02-20" } });
  await ctx.call(user, "PUT", `/favorites/recipes/${recipe._id}`);

  const other = await ctx.makeClient();
  assert.equal((await ctx.call(other, "DELETE", `/recipes/${recipe._id}`)).status, 403);
  assert.equal((await ctx.call(user, "DELETE", `/recipes/${recipe._id}`)).status, 200);

  const day = (await ctx.post(user, `/dietdays/date/2026-02-20`, {})).dietDay;
  assert.equal(day.meals[1].customRecipes.length, 1, "el plato del historial sigue");
  assert.equal(day.meals[1].customRecipes[0].recipe.name, "Receta a borrar");
  const stored = await ctx.model("Recipe").findById(recipe._id).lean();
  assert.equal(stored.userId, undefined, "sin dueño");
  assert.equal(stored.verified, false);
  assert.ok(!names(await ctx.get(user, "/recipes/search?search=borrar")).includes("Receta a borrar"));
  assert.deepEqual((await ctx.get(user, "/auth/me")).user.favorites.recipes, []);

  const unused = (await composeRecipe(user, "Receta sin uso")).recipe;
  assert.equal((await ctx.call(user, "DELETE", `/recipes/${unused._id}`)).status, 200);
  assert.equal(await ctx.count("Recipe", { _id: unused._id }), 0);
});

test("nadie más que el dueño puede añadir o quitar ingredientes de una receta (ni de una verificada)", async () => {
  const owner = await ctx.makeClient();
  const attacker = await ctx.makeClient();
  const recipe = (await composeRecipe(owner, "Receta blindada")).recipe;
  const ingredient = (await ctx.model("Recipe").findById(recipe._id).lean()).customProducts[0];
  await ctx.call(attacker, "DELETE", `/recipes/${recipe._id}/customproducts/${ingredient._id}`);
  // Añadir un ingrediente "por id" ya no existe: van dentro de la receta.
  assert.equal((await ctx.call(attacker, "POST", `/recipes/${recipe._id}/customproducts/${ctx.oid()}`)).status, 404);
  const stored = await ctx.model("Recipe").findById(recipe._id).lean();
  assert.deepEqual(stored.customProducts.map((item) => String(item._id)), [String(ingredient._id)]);
});

test("borrar una receta global usada en una plantilla de dieta: la plantilla la sigue pintando", async () => {
  const admin = await ctx.makeAdmin({ roles: ["admin", "user"] });
  const recipe = await ctx.post(admin, "/recipes", { name: "Global en plantilla", verified: true });
  const template = await ctx.model("DietTemplate").create({
    trainerId: ctx.oid(),
    name: "Usa receta global",
    menus: [{ name: "M", meals: [{ slot: "Comida", alternatives: [{ label: "A", customRecipes: [{ recipe: recipe._id, quantity: 100 }] }] }] }],
  });
  await ctx.del(admin, `/recipes/${recipe._id}`);
  const stored = await ctx.model("DietTemplate").findById(template._id);
  const customRecipe = stored.menus[0].meals[0].alternatives[0].customRecipes[0];
  assert.equal(customRecipe.recipe.name, "Global en plantilla", "sin referencias rotas");
  assert.equal((await ctx.model("Recipe").findById(recipe._id).lean()).verified, false, "ya no es del catálogo");
});

// --- Script de índices --------------------------------------------------------------

test("rebuild-indexes deja en products solo los de búsqueda y la segunda pasada no cambia nada", async () => {
  const script = require("../scripts/rebuild-indexes");
  const before = (await Product.collection.indexes()).map((i) => i.name).sort();
  const { collections } = await script.rebuildIndexes(Product.db.db, { skipBackfill: true });
  const after = (await Product.collection.indexes()).map((i) => i.name).sort();
  assert.deepEqual(after, before, "segunda pasada: los mismos índices");
  const products = collections.find((result) => result.name === "products");
  assert.deepEqual([products.retired, products.added], [[], []]);
  const expected = ["_id_", ...script.PRODUCT_INDEXES.map((d) => d.options.name)].sort();
  assert.deepEqual(after, expected, "solo los índices del script");
  // Los de búsqueda se declaran solo en el script: el schema no lleva ninguno.
  assert.deepEqual(Product.schema.indexes(), []);
});
