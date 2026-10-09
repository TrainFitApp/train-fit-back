const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const { modelsByCollection } = require("../rebuild-indexes");
const { migrateIndexes } = require("./99-indexes");

// Todos los modelos cargados antes de que arranque la base.
modelsByCollection();
const ExerciseScore = require("../../components/exerciseScores/exercise-score-schema");

const db = useTestDb();
const conn = () => db.mongoose.connection.db;

test("aplica: fuera los índices que ya no declara nadie, dentro los de búsqueda; idempotente", async () => {
  await db.reset();
  await db.raw("users").createIndex({ legacyField: 1 });

  const first = await migrateIndexes(conn());
  assert.equal(first.retired, 1);
  assert.ok(first.added > 0, "los de búsqueda no los crea mongoose al arrancar");
  assert.ok(!(await db.raw("users").indexes()).some((index) => index.name === "legacyField_1"));

  const second = await migrateIndexes(conn());
  assert.deepEqual([second.retired, second.added], [0, 0]);
  assert.equal(second.collections, first.collections);
});

test("si un índice no se puede crear, el paso falla (y no se apunta)", async () => {
  await db.reset();
  const scores = ExerciseScore.collection.collectionName;
  await conn().collection(scores).dropIndexes();
  const pair = { trainerId: db.oid(), exerciseId: db.oid() };
  await db.raw(scores).insertMany([{ ...pair }, { ...pair }]);

  await assert.rejects(migrateIndexes(conn()), new RegExp(`Índices sin crear en ${scores}`));

  await db.raw(scores).deleteMany({});
  await migrateIndexes(conn());
});
