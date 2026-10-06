const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const DietDay = require("../dietDays/diet-days-schema");
const Product = require("../products/product-schema");
const dao = require("./custom-product-dao");

// Vía de escritura de TODO lo que el cliente apunta en una comida: productos
// del catálogo, líneas con macros propios y adiciones rápidas. Los alimentos
// van embebidos en su comida (DietDay.meals[].customProducts[]).
const db = useTestDb();

async function seedDay(userId = db.oid()) {
  return DietDay.create({ userId, date: "2026-05-01", meals: [{ name: "Desayuno" }, { name: "Comida" }] });
}

const mealItems = async (dayId, index = 0) => (await DietDay.findById(dayId).lean()).meals[index].customProducts;

test("createCustomProductAndAddToMeal mete el producto en la comida y lo devuelve poblado", async () => {
  await db.reset();
  const day = await seedDay();
  const product = await Product.create({ name: "Avena", energyKcal100g: 380 });
  const mealId = day.meals[0]._id;

  const created = await dao.createCustomProductAndAddToMeal(mealId, { quantity: 50, product: String(product._id), empty: "" });
  assert.equal(created.product.name, "Avena");
  assert.equal(created.mealId, undefined, "no guarda a qué comida pertenece: va dentro");
  const saved = await mealItems(day._id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].quantity, 50);
  assert.equal(await Product.countDocuments(), 1, "un id existente no crea otro Product");
});

test("un producto inline se da de alta a nombre del usuario; sin usuario, no", async () => {
  await db.reset();
  const userId = db.oid();
  const day = await seedDay(userId);

  const created = await dao.createCustomProductAndAddToMeal(
    day.meals[0]._id,
    { quantity: 100, consumed: false, product: { name: "Pan casero", energyKcal100g: 250, verified: true } },
    userId,
  );
  const product = await Product.findById(created.product._id).lean();
  assert.equal(String(product.userId), String(userId));
  assert.equal(product.verified, undefined, "verified no se acepta del cliente");
  assert.equal(created.consumed, false, "false se conserva");
});

test("una adición rápida: sin product y con nombre propio; nunca nace pautada", async () => {
  await db.reset();
  const day = await seedDay();
  const created = await dao.createCustomProductAndAddToMeal(day.meals[1]._id, {
    quickAdd: true,
    name: "Tapa en el bar",
    energyKcal100g: 300,
    quantity: 120,
    assignedByTrainerId: db.oid(),
    assignedQuantity: 100,
  });
  assert.equal(created.product, undefined);
  assert.equal(created.name, "Tapa en el bar");
  assert.equal(created.assignedByTrainerId, null);
  assert.equal(created.assignedQuantity, null);
});

test("updateCustomProduct guarda solo lo que difiere del Product; null y 0 se respetan", async () => {
  await db.reset();
  const day = await seedDay();
  const product = await Product.create({ name: "Arroz", energyKcal100g: 350, protein100g: 7 });
  const created = await dao.createCustomProductAndAddToMeal(day.meals[0]._id, { quantity: 80, product: String(product._id) });

  let updated = await dao.updateCustomProduct({ _id: created._id, quantity: 90, energyKcal100g: 360, protein100g: 7, fat100g: 0, sugars100g: null });
  assert.equal(updated.quantity, 90);
  assert.equal(updated.energyKcal100g, 360);
  assert.equal(updated.protein100g, undefined, "igual que el catálogo: no se guarda");
  assert.equal(updated.fat100g, 0);
  assert.equal(updated.sugars100g, null);

  updated = await dao.updateCustomProduct({ _id: created._id, quantity: 90, product: { _id: product._id, name: "Arroz" } });
  assert.equal(updated.energyKcal100g, undefined, "lo que no viene se quita");
  assert.equal(String(updated.product._id), String(product._id));

  assert.equal(await dao.updateCustomProduct({ _id: db.oid(), quantity: 1 }), null);
});

test("setConsumed y setQuantity tocan solo ese alimento", async () => {
  await db.reset();
  const day = await seedDay();
  const a = await dao.createCustomProductAndAddToMeal(day.meals[0]._id, { quickAdd: true, name: "A", quantity: 10 });
  const b = await dao.createCustomProductAndAddToMeal(day.meals[0]._id, { quickAdd: true, name: "B", quantity: 20 });

  assert.equal((await dao.setConsumed(a._id, "sí")).consumed, true);
  const quantity = await dao.setQuantity(b._id, 35);
  assert.equal(quantity.quantity, 35);
  assert.equal(quantity.assignedQuantity, null);
  const saved = await mealItems(day._id);
  assert.deepEqual(saved.map((item) => [item.name, item.consumed, item.quantity]), [["A", true, 10], ["B", false, 35]]);
});
