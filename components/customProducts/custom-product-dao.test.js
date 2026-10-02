const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const dao = require("./custom-product-dao");
const customProductSchema = require("./custom-product-schema");
const mealSchema = require("../meals/meal-schema");
const productSchema = require("../products/product-schema");

afterEach(() => mock.restoreAll());

// Vía de escritura de TODO lo que el cliente apunta en una comida: productos
// del catálogo, líneas con macros propios y adiciones rápidas. Lo delicado es
// buildCustomProductUpdate, que decide qué se guarda ($set) y qué se borra
// ($unset) en cada edición: un campo que caiga del lado equivocado se pierde
// o se queda pegado sin que nada avise.

/** Captura el update que el DAO manda a mongo al actualizar. */
function captureUpdate(currentDoc) {
  const calls = [];
  mock.method(customProductSchema, "findById", (_id, cb) => cb(null, currentDoc));
  mock.method(customProductSchema, "findByIdAndUpdate", (_id, update, _opts, cb) => {
    calls.push(update);
    cb(null, { _id, ...update.$set });
  });
  return calls;
}

// --- creación ---------------------------------------------------------------

test("createCustomProductAndAddToMeal cuelga el producto de la comida y le pone mealId", async () => {
  const created = { _id: "cp-1" };
  mock.method(customProductSchema, "create", async () => created);
  const updates = [];
  mock.method(customProductSchema, "findByIdAndUpdate", async (id, update) => {
    updates.push({ id, update });
    return created;
  });
  const mealUpdates = [];
  mock.method(mealSchema, "findByIdAndUpdate", async (id, update) => {
    mealUpdates.push({ id, update });
    return {};
  });

  const result = await dao.createCustomProductAndAddToMeal("meal-1", { quantity: 100 });

  assert.equal(result, created);
  assert.deepEqual(updates[0], { id: "cp-1", update: { $set: { mealId: "meal-1" } } });
  assert.deepEqual(mealUpdates[0], {
    id: "meal-1",
    update: { $push: { customProducts: "cp-1" } },
  });
});

test("createCustomProductAndAddToMeal tira los vacíos pero conserva 0 y false", async () => {
  let payload;
  mock.method(customProductSchema, "create", async (doc) => {
    payload = doc;
    return { _id: "cp-1" };
  });
  mock.method(customProductSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(mealSchema, "findByIdAndUpdate", async () => ({}));

  await dao.createCustomProductAndAddToMeal("meal-1", {
    quantity: 100,
    // 0 y false son valores reales: "este alimento no tiene grasa", "no es
    // vegano". Si se colaran en la limpieza, el producto se guardaría sin
    // ellos y al leerlo caería al valor del catálogo.
    fat100g: 0,
    vegan: false,
    name: "",
    protein100g: undefined,
  });

  assert.equal(payload.fat100g, 0);
  assert.equal(payload.vegan, false);
  assert.equal("name" in payload, false, "el nombre vacío no se guarda");
  assert.equal("protein100g" in payload, false);
});

test("createCustomProductAndAddToMeal guarda el Product nuevo a nombre del usuario", async () => {
  // Producto inline: el cliente lo acaba de crear y viaja dentro del
  // CustomProduct sin _id todavía.
  let productDoc;
  mock.method(productSchema, "create", async (doc) => {
    productDoc = doc;
    return { _id: "product-nuevo" };
  });
  let customProductDoc;
  mock.method(customProductSchema, "create", async (doc) => {
    customProductDoc = doc;
    return { _id: "cp-1" };
  });
  mock.method(customProductSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(mealSchema, "findByIdAndUpdate", async () => ({}));

  await dao.createCustomProductAndAddToMeal(
    "meal-1",
    { quantity: 100, product: { name: "Tortilla" } },
    "user-1",
  );

  assert.equal(productDoc.userId, "user-1", "sin dueño no saldría en 'mis productos'");
  assert.equal(productDoc.name, "Tortilla");
  assert.equal(customProductDoc.product, "product-nuevo");
});

test("createCustomProductAndAddToMeal no duplica un Product que ya existe", async () => {
  const productCreate = mock.method(productSchema, "create", async () => ({ _id: "x" }));
  mock.method(customProductSchema, "create", async () => ({ _id: "cp-1" }));
  mock.method(customProductSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(mealSchema, "findByIdAndUpdate", async () => ({}));

  await dao.createCustomProductAndAddToMeal(
    "meal-1",
    { quantity: 100, product: { _id: "product-existente" } },
    "user-1",
  );

  assert.equal(productCreate.mock.callCount(), 0);
});

test("createCustomProductAndAddToMeal sin usuario no crea Product aunque venga inline", async () => {
  // Sin idUser no hay a quién atribuirlo: se guarda tal cual dentro del
  // CustomProduct en vez de colar un Product huérfano en el catálogo.
  const productCreate = mock.method(productSchema, "create", async () => ({ _id: "x" }));
  mock.method(customProductSchema, "create", async () => ({ _id: "cp-1" }));
  mock.method(customProductSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(mealSchema, "findByIdAndUpdate", async () => ({}));

  await dao.createCustomProductAndAddToMeal("meal-1", { quantity: 100, product: { name: "X" } });

  assert.equal(productCreate.mock.callCount(), 0);
});

test("createCustomProductAndAddToMeal admite una adición rápida: sin product y con nombre propio", async () => {
  let payload;
  mock.method(customProductSchema, "create", async (doc) => {
    payload = doc;
    return { _id: "cp-1" };
  });
  const productCreate = mock.method(productSchema, "create", async () => ({ _id: "x" }));
  mock.method(customProductSchema, "findByIdAndUpdate", async () => ({}));
  mock.method(mealSchema, "findByIdAndUpdate", async () => ({}));

  await dao.createCustomProductAndAddToMeal(
    "meal-1",
    { quantity: 100, quickAdd: true, name: "Cena fuera", energyKcal100g: 700 },
    "user-1",
  );

  assert.equal(productCreate.mock.callCount(), 0, "una adición rápida no crea catálogo");
  assert.equal(payload.quickAdd, true);
  assert.equal(payload.name, "Cena fuera");
  assert.equal(payload.energyKcal100g, 700);
});

// --- actualización ----------------------------------------------------------

test("updateCustomProduct guarda el macro que se aparta del producto del catálogo", async () => {
  const updates = captureUpdate({ product: { energyKcal100g: 100 } });
  await dao.updateCustomProduct({ _id: "cp-1", energyKcal100g: 250 });
  assert.equal(updates[0].$set.energyKcal100g, 250);
});

test("updateCustomProduct borra el macro que vuelve a coincidir con el catálogo", async () => {
  // Así la línea vuelve a seguir al producto base: si el catálogo se corrige
  // más adelante, esta comida se corrige con él en vez de quedarse pegada a
  // una copia idéntica.
  const updates = captureUpdate({ product: { energyKcal100g: 100 } });
  await dao.updateCustomProduct({ _id: "cp-1", energyKcal100g: 100 });
  assert.equal(updates[0].$unset.energyKcal100g, "");
  assert.equal(updates[0].$set?.energyKcal100g, undefined);
});

test("updateCustomProduct compara los macros con tolerancia de coma flotante", () => {
  const updates = captureUpdate({ product: { protein100g: 0.1 + 0.2 } });
  return dao.updateCustomProduct({ _id: "cp-1", protein100g: 0.3 }).then(() => {
    // 0.1 + 0.2 === 0.30000000000000004: sin epsilon se guardaría una copia
    // del valor del catálogo en cada edición.
    assert.equal(updates[0].$unset.protein100g, "");
  });
});

test("updateCustomProduct borra el macro que no viene en la petición", async () => {
  // El front manda SOLO los campos que tiene (serializeCustomProduct), así
  // que "no viene" significa "ya no hay override", no "déjalo como estaba".
  const updates = captureUpdate({ product: {} });
  await dao.updateCustomProduct({ _id: "cp-1", quantity: 150 });
  assert.equal(updates[0].$unset.energyKcal100g, "");
  assert.equal(updates[0].$unset.protein100g, "");
  assert.equal(updates[0].$set.quantity, 150);
});

test("updateCustomProduct guarda un macro a 0 en vez de borrarlo", async () => {
  // "Este alimento tiene 0 g de grasa" es un dato, no un hueco: con $unset
  // caería al valor del catálogo y la comida sumaría de más.
  const updates = captureUpdate({ product: { fat100g: 20 } });
  await dao.updateCustomProduct({ _id: "cp-1", fat100g: 0 });
  assert.equal(updates[0].$set.fat100g, 0);
});

test("updateCustomProduct respeta un null explícito como valor guardado", async () => {
  const updates = captureUpdate({ product: {} });
  await dao.updateCustomProduct({ _id: "cp-1", energyKcal100g: null });
  assert.equal(updates[0].$set.energyKcal100g, null);
});

test("updateCustomProduct borra el campo de texto que llega vacío", async () => {
  const updates = captureUpdate({ product: {} });
  await dao.updateCustomProduct({ _id: "cp-1", name: "   ", quantity: 100 });
  assert.equal(updates[0].$unset.name, "");
});

test("updateCustomProduct nunca mete el _id en el $set", async () => {
  const updates = captureUpdate({ product: {} });
  await dao.updateCustomProduct({ _id: "cp-1", quantity: 100 });
  assert.equal(updates[0].$set._id, undefined);
});

test("updateCustomProduct guarda los campos que no son macros tal cual", async () => {
  const updates = captureUpdate({ product: {} });
  await dao.updateCustomProduct({
    _id: "cp-1",
    quantity: 120,
    quickAdd: true,
    name: "Cena fuera",
    vegan: false,
  });
  assert.equal(updates[0].$set.quantity, 120);
  assert.equal(updates[0].$set.quickAdd, true);
  assert.equal(updates[0].$set.name, "Cena fuera");
  assert.equal(updates[0].$set.vegan, false);
});

test("updateCustomProduct sobre un id que ya no existe devuelve null sin escribir", async () => {
  mock.method(customProductSchema, "findById", (_id, cb) => cb(null, null));
  const write = mock.method(customProductSchema, "findByIdAndUpdate", (_id, _u, _o, cb) => cb(null, {}));
  assert.equal(await dao.updateCustomProduct({ _id: "cp-1", quantity: 1 }), null);
  assert.equal(write.mock.callCount(), 0);
});

test("updateCustomProduct propaga el error de lectura", async () => {
  mock.method(customProductSchema, "findById", (_id, cb) => cb(new Error("mongo caído")));
  await assert.rejects(() => dao.updateCustomProduct({ _id: "cp-1" }), /mongo caído/);
});

// --- seguimiento (nunca bloqueado por lo pautado) ---------------------------

test("setConsumed solo toca consumed y lo normaliza a booleano", async () => {
  const calls = [];
  mock.method(customProductSchema, "findByIdAndUpdate", async (id, update, opts) => {
    calls.push({ id, update, opts });
    return {};
  });
  await dao.setConsumed("cp-1", "sí");
  assert.deepEqual(calls[0].update, { $set: { consumed: true } });
  await dao.setConsumed("cp-1", 0);
  assert.deepEqual(calls[1].update, { $set: { consumed: false } });
});

test("setQuantity solo toca quantity y nunca assignedQuantity", async () => {
  // assignedQuantity es la referencia de lo que pautó el profesional: si se
  // moviera al ajustar lo consumido, el delta que ve el cliente (+46/-28)
  // siempre sería 0.
  const calls = [];
  mock.method(customProductSchema, "findByIdAndUpdate", async (id, update) => {
    calls.push(update);
    return {};
  });
  await dao.setQuantity("cp-1", 180);
  assert.deepEqual(calls[0], { $set: { quantity: 180 } });
});

test("delete borra solo ese CustomProduct", async () => {
  const calls = [];
  mock.method(customProductSchema, "deleteOne", (filter, cb) => {
    calls.push(filter);
    cb(null, {});
  });
  await dao.delete("cp-1");
  assert.deepEqual(calls[0], { _id: "cp-1" });
});
