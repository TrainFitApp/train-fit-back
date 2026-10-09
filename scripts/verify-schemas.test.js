const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const { modelsByCollection } = require("./rebuild-indexes");
const { verifySchemas } = require("./verify-schemas");

// Todos los modelos cargados antes de que arranque la base.
modelsByCollection();
const db = useTestDb({ name: "trainfit_verify_schemas" });

test("cuenta los documentos que no pasan su schema y los campos que no declara", async () => {
  await db.reset();
  await db.raw("products").insertMany([
    { name: "Pollo", energyKcal100g: 120 },
    { name: "Atún", protein100g: -12.6, sugar100g: 3 },
  ]);
  await db.raw("users").insertOne({ email: "u@x.test", tourTable: true });
  // Un discriminador se valida con su propio schema (las series de una sesión).
  await db.raw("workouts").insertOne({ kind: "session", name: "Pierna", exercises: [{ order: 0, sets: [{ reps: 4222 }] }] });
  await db.raw("legacystuff").insertOne({ anything: true });

  const logs = [];
  const report = await verifySchemas(db.mongoose.connection.db, { log: (line) => logs.push(line) });
  const byName = (name) => report.collections.find((result) => result.name === name);

  assert.equal(report.invalid, 2);
  assert.deepEqual(byName("products").errors, [["protein100g: min", 1]]);
  assert.deepEqual(byName("products").undeclared, [["sugar100g", 1]]);
  assert.equal(byName("products").docs, 2);
  assert.deepEqual(byName("workouts").errors, [["exercises.N.sets.N.reps: max", 1]]);
  assert.deepEqual(byName("users").undeclared, [["tourTable", 1]]);
  assert.equal(byName("users").invalid, 0);
  assert.equal(report.undeclared, 2);
  assert.equal(byName("legacystuff"), undefined, "una colección sin modelo no se mira");
  assert.match(logs.at(-1), /2 documentos no pasan su schema, 2 campos sin declarar/);
});

test("una base limpia sale a cero", async () => {
  await db.reset();
  await db.raw("products").insertOne({ name: "Pollo", energyKcal100g: 120 });

  const report = await verifySchemas(db.mongoose.connection.db);

  assert.equal(report.invalid, 0);
  assert.equal(report.undeclared, 0);
});
