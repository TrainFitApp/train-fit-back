const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const favoritesDao = require("../../components/favorites/favorites-dao");
require("../../components/users/user-schema");
const { migrateUserFavorites } = require("./10-user-favorites");

const db = useTestDb();

test("los favoritos viejos pasan a favorites (sin repetidos), los campos viejos desaparecen; idempotente", async () => {
  await db.reset();
  const [p1, p2, r1, e1, user, plain] = [db.oid(), db.oid(), db.oid(), db.oid(), db.oid(), db.oid()];
  await db.raw("users").insertMany([
    { _id: user, email: "a@test.es", archivedProducts: [p1, p2], archivedRecipes: [r1], archivedExercises: [e1], favorites: { products: [p1] } },
    { _id: plain, email: "b@test.es" },
  ]);
  const conn = db.mongoose.connection.db;

  assert.deepEqual(await migrateUserFavorites(conn, { dryRun: true }), { users: 1 });
  assert.ok((await db.raw("users").findOne({ _id: user })).archivedProducts, "en seco no escribe");

  await migrateUserFavorites(conn);
  const raw = await db.raw("users").findOne({ _id: user });
  assert.equal("archivedProducts" in raw || "archivedRecipes" in raw || "archivedExercises" in raw, false);
  assert.deepEqual((await favoritesDao.list(user, "products")).map(String).sort(), [String(p1), String(p2)].sort());
  assert.deepEqual((await favoritesDao.list(user, "recipes")).map(String), [String(r1)]);
  assert.deepEqual((await favoritesDao.list(user, "exercises")).map(String), [String(e1)]);
  assert.equal((await db.raw("users").findOne({ _id: plain })).favorites, undefined, "quien no tenía nada no se toca");

  assert.deepEqual(await migrateUserFavorites(conn), { users: 0 });
});
