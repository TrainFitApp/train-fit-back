const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const { rebuildIndexes, declaredIndexNames, modelsByCollection, PRODUCT_INDEXES, RECIPE_INDEXES } = require("./rebuild-indexes");

// Todos los modelos cargados ANTES de que arranque la base: useTestDb crea
// sus índices como lo haría la API al arrancar, y eso es la referencia.
const groups = modelsByCollection();
const ExerciseScore = require("../components/exerciseScores/exercise-score-schema");

const db = useTestDb({ name: "trainfit_rebuild_indexes" });
const conn = () => db.mongoose.connection.db;
const names = async (collection) => (await conn().collection(collection).indexes()).map((index) => index.name).sort();
const byName = (report, name) => report.collections.find((result) => result.name === name);
const SEARCH = { products: PRODUCT_INDEXES, recipes: RECIPE_INDEXES };

async function snapshot() {
  const all = {};
  for (const name of groups.keys()) {
    all[name] = await names(name).catch(() => []);
  }
  return all;
}

test("deja en cada colección exactamente los índices del código, con los nombres de mongoose", async () => {
  await db.reset();
  // Referencia: lo que mongoose crea al arrancar (la facturación de trainers
  // no crea los suyos hasta que se usa).
  const atStartup = {};
  for (const [name, models] of groups) {
    if (models.every((model) => model.schema.options.autoIndex !== false)) atStartup[name] = await names(name);
  }

  await conn().collection("users").createIndex({ legacyField: 1 });
  const dietDayIndex = atStartup.dietdays.find((name) => name !== "_id_");
  await conn().collection("dietdays").dropIndex(dietDayIndex);
  await conn().collection("legacystuff").createIndex({ x: 1 });
  await conn().collection("schemamigrations").insertOne({ _id: "01-nutrition-model" });

  const report = await rebuildIndexes(conn());

  assert.deepEqual(report.failed, []);
  for (const [name, models] of groups) {
    assert.deepEqual(await names(name), ["_id_", ...declaredIndexNames(name, models)].sort(), name);
    if (!atStartup[name]) continue;
    const search = (SEARCH[name] || []).map((definition) => definition.options.name);
    assert.deepEqual(await names(name), [...atStartup[name], ...search].sort(), `${name}: mismos nombres que al arrancar`);
  }
  assert.deepEqual(await names("products"), ["_id_", ...PRODUCT_INDEXES.map((definition) => definition.options.name)].sort());
  assert.ok((await names("trainerbillingaccounts")).length > 1, "la facturación de trainers también");

  assert.deepEqual(byName(report, "users").retired, ["legacyField_1"]);
  assert.ok(byName(report, "dietdays").added.includes(dietDayIndex));
  assert.deepEqual(report.unmodeled, ["legacystuff"], "sin modelo: se informa (el registro de pasos no cuenta)");
  assert.deepEqual(await names("legacystuff"), ["_id_", "x_1"], "y no se toca");
});

test("la segunda pasada deja lo mismo: nada retirado ni nuevo", async () => {
  const before = await snapshot();
  const report = await rebuildIndexes(conn());
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(report.failed, []);
  for (const result of report.collections) {
    assert.deepEqual([result.retired, result.added], [[], []], result.name);
  }
});

test("--dry-run informa y no escribe nada", async () => {
  await db.reset();
  await conn().collection("users").createIndex({ legacyField: 1 });
  const product = db.oid();
  await db.raw("products").insertOne({ _id: product, name: "Leche entera", namePrefixes: ["le"] });
  const before = await snapshot();

  const report = await rebuildIndexes(conn(), { dryRun: true });

  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(byName(report, "users").retired, ["legacyField_1"]);
  const raw = await db.raw("products").findOne({ _id: product });
  assert.equal(raw.searchTokens, undefined, "el backfill tampoco escribe");
  assert.deepEqual(raw.namePrefixes, ["le"]);
});

test("rellena los campos de búsqueda antes de crear los índices", async () => {
  await db.reset();
  const product = db.oid();
  await db.raw("products").insertOne({ _id: product, name: "Leche entera", brand: "Pascual", namePrefixes: ["le"] });

  await rebuildIndexes(conn());

  const raw = await db.raw("products").findOne({ _id: product });
  assert.equal(raw.nameNormalized, "leche entera");
  assert.equal(raw.brandNormalized, "pascual");
  assert.ok(raw.searchTokens.includes("leche"));
  assert.equal(raw.namePrefixes, undefined);
});

test("un único que choca con datos duplicados se informa y no para al resto", async () => {
  await db.reset();
  const scores = ExerciseScore.collection.collectionName;
  await conn().collection(scores).dropIndexes();
  const pair = { trainerId: db.oid(), exerciseId: db.oid() };
  await db.raw(scores).insertMany([{ ...pair }, { ...pair }]);
  await conn().collection("users").createIndex({ legacyField: 1 });

  const report = await rebuildIndexes(conn());

  assert.deepEqual(report.failed, [scores]);
  assert.ok(byName(report, scores).missing.includes("trainerId_1_exerciseId_1"));
  assert.match(byName(report, scores).errors.join(" "), /E11000/);
  assert.ok(!(await names("users")).includes("legacyField_1"), "las demás colecciones se rehacen igual");

  await db.raw(scores).deleteMany({});
  assert.deepEqual((await rebuildIndexes(conn())).failed, [], "con los datos arreglados, se crea");
});

test("una base vieja: sus índices se borran antes del backfill, así que no lo frenan ni lo paran", async () => {
  await db.reset();
  const products = conn().collection("products");
  await products.dropIndexes();
  // Como en PRO: los arrays de prefijos con su índice multikey, y un único
  // viejo sobre un campo que el backfill reescribe.
  await products.createIndex({ namePrefixes: 1 }, { name: "old_namePrefixes" });
  await products.createIndex({ nameNormalized: 1 }, { name: "old_unique_nameNormalized", unique: true });
  const [upper, lower] = [db.oid(), db.oid()];
  await products.insertMany([
    { _id: upper, name: "LECHE", nameNormalized: "x1", namePrefixes: ["l", "le", "lec"] },
    { _id: lower, name: "leche", nameNormalized: "x2", namePrefixes: ["l", "le", "lec"] },
  ]);

  const report = await rebuildIndexes(conn());

  assert.deepEqual(report.failed, []);
  for (const _id of [upper, lower]) {
    const raw = await db.raw("products").findOne({ _id });
    assert.equal(raw.nameNormalized, "leche");
    assert.equal(raw.namePrefixes, undefined);
  }
  assert.deepEqual(byName(report, "products").retired.sort(), ["old_namePrefixes", "old_unique_nameNormalized"]);
  assert.deepEqual(await names("products"), ["_id_", ...PRODUCT_INDEXES.map((definition) => definition.options.name)].sort());
});

