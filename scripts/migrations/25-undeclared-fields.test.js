const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { migrateUndeclaredFields } = require("./25-undeclared-fields");

const db = useTestDb();

async function seed() {
  await db.reset();
  const ids = Object.fromEntries(["user", "clean", "day", "onlyOld", "both", "nullNew"].map((key) => [key, db.oid()]));
  await db.raw("users").insertMany([
    {
      _id: ids.user,
      email: "u@x.test",
      kcalTotal: 2500,
      proteinsGTotal: 125,
      carbohydratesGTotal: 300,
      fatGTotal: 70,
      tourTable: true,
      tourDiet: true,
      nutritionalGoals: [{ _id: db.oid(), kcalTotal: 2500 }],
      __v: 3,
    },
    { _id: ids.clean, email: "c@x.test", __v: 0 },
  ]);
  await db.raw("dietdays").insertOne({ _id: ids.day, userId: ids.user, date: "2026-07-01", weight: null, meals: [], __v: 0 });
  await db.raw("products").insertMany([
    { _id: ids.onlyOld, name: "Galleta", sugar100g: 21.5 },
    { _id: ids.both, name: "Zumo", sugar100g: 9, sugars100g: 10 },
    { _id: ids.nullNew, name: "Yogur", sugar100g: 4, sugars100g: null },
  ]);
  return ids;
}

const find = (collection, _id) => db.raw(collection).findOne({ _id });

test("mueve el azúcar al campo del schema y quita lo que nadie declara", async () => {
  const ids = await seed();

  const stats = await migrateUndeclaredFields(db.mongoose.connection.db);

  assert.deepEqual(stats, { sugarMoved: 2, sugarDropped: 1, users: 1, dietdays: 1 });
  const onlyOld = await find("products", ids.onlyOld);
  assert.equal(onlyOld.sugars100g, 21.5);
  assert.equal("sugar100g" in onlyOld, false);
  assert.equal((await find("products", ids.nullNew)).sugars100g, 4, "un sugars100g vacío también se rellena");
  const both = await find("products", ids.both);
  assert.equal(both.sugars100g, 10, "si ya lo tenía, manda el del schema");
  assert.equal("sugar100g" in both, false);

  const user = await find("users", ids.user);
  for (const field of ["kcalTotal", "proteinsGTotal", "carbohydratesGTotal", "fatGTotal", "tourTable", "tourDiet"]) {
    assert.equal(field in user, false, `users.${field} desaparece`);
  }
  assert.equal(user.nutritionalGoals[0].kcalTotal, 2500, "el objetivo embebido no se toca");
  assert.equal(user.__v, 4, "sube la versión para la concurrencia optimista");
  assert.equal((await find("users", ids.clean)).__v, 0, "un usuario sin restos no se toca");
  const day = await find("dietdays", ids.day);
  assert.equal("weight" in day, false);
  assert.equal(day.__v, 1);
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  const dry = await migrateUndeclaredFields(nativeDb, { dryRun: true });
  assert.deepEqual(dry, { sugarMoved: 2, sugarDropped: 1, users: 1, dietdays: 1 });
  assert.equal((await find("products", ids.onlyOld)).sugar100g, 21.5, "dry-run: sin cambios");

  await migrateUndeclaredFields(nativeDb);
  assert.deepEqual(await migrateUndeclaredFields(nativeDb), { sugarMoved: 0, sugarDropped: 0, users: 0, dietdays: 0 });
});
