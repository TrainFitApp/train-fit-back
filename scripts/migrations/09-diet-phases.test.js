const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../../integration/support/db");
const DietPhase = require("../../components/dietPhases/diet-phase-schema");
const DietTemplate = require("../../components/dietTemplates/diet-template-schema");
const Product = require("../../components/products/product-schema");
const dietPhaseService = require("../../components/dietPhases/diet-phase-service");
const { migrateDietPhases } = require("./09-diet-phases");

// Datos en el formato ANTERIOR: biblioteca y copias asignadas mezcladas en
// `diettemplates`, una copia por semana preparada. Sembrados en crudo.
const db = useTestDb();

const menu = (name, product, quantity) => ({
  _id: db.oid(),
  name,
  meals: [
    {
      _id: db.oid(),
      slot: "Comida",
      alternatives: [{ _id: db.oid(), label: "", customProducts: [{ _id: db.oid(), product, quantity, mealId: db.oid() }], customRecipes: [] }],
    },
  ],
});

async function seedOldFormat() {
  const pollo = await Product.create({ name: "Pollo", energyKcal100g: 165 });
  const ids = Object.fromEntries(
    ["trainer", "client", "library", "head1", "week3", "head2", "loose", "otherClient"].map((name) => [name, db.oid()])
  );
  await db.raw("diettemplates").insertMany([
    // Biblioteca, con campos de fase a null que ya no existen.
    { _id: ids.library, trainerId: ids.trainer, name: "Base", clientId: null, startDate: null, status: null, menus: [menu("Único", pollo._id, 100)], suitableFor: [], createdAt: new Date("2026-08-01") },
    // Fase 1: cortada por la fase 2.
    {
      _id: ids.head1,
      trainerId: ids.trainer,
      clientId: ids.client,
      name: "Base",
      phaseId: ids.head1,
      phaseName: "Adaptación",
      phaseTarget: { kcal: 2000, protein: 140, carbs: 200, fat: 70, source: "calculated" },
      phaseProteinPerKg: 2,
      phaseNeed: { computedAt: new Date(), target: { kcal: 2000 } },
      sourceTemplateId: ids.library,
      startDate: "2026-08-03",
      endDate: "2026-08-16",
      status: "superseded",
      supersededBy: ids.head2,
      menus: [menu("Único", pollo._id, 150)],
      createdAt: new Date("2026-08-03"),
    },
    // Fase 2 con su semana 3 preparada (otro documento con el mismo phaseId).
    {
      _id: ids.head2,
      trainerId: ids.trainer,
      clientId: ids.client,
      name: "Definición plan",
      phaseId: ids.head2,
      phaseName: "Definición",
      startDate: "2026-08-17",
      endDate: "2026-08-30",
      status: "superseded",
      supersededBy: ids.week3,
      menus: [menu("Único", pollo._id, 140)],
      createdAt: new Date("2026-08-17"),
    },
    { _id: ids.week3, trainerId: ids.trainer, clientId: ids.client, name: "Definición plan", phaseId: ids.head2, startDate: "2026-08-31", endDate: null, status: "active", menus: [menu("Único", pollo._id, 120)], createdAt: new Date("2026-08-28") },
    // Plan suelto (sin phaseId) de otro cliente.
    { _id: ids.loose, trainerId: ids.trainer, clientId: ids.otherClient, name: "Suelto", startDate: "2026-09-01", endDate: null, status: "active", menus: [menu("Único", pollo._id, 90)], createdAt: new Date("2026-09-01") },
  ]);
  await db.raw("users").insertMany([
    { _id: ids.client, email: "c@test.es", roles: ["user"], timezone: "Europe/Madrid" },
    { _id: ids.otherClient, email: "o@test.es", roles: ["user"], timezone: "Europe/Madrid" },
  ]);
  return ids;
}

test("dry-run cuenta lo que haría y no escribe nada", async () => {
  await db.reset();
  await seedOldFormat();
  const stats = await migrateDietPhases(db.mongoose.connection.db, { dryRun: true });
  assert.equal(stats.phases, 3);
  assert.equal(stats.contents, 4);
  assert.equal(stats.removedCopies, 4);
  assert.equal(stats.templatesCleaned, 1);
  assert.equal(await db.raw("dietphases").countDocuments(), 0);
  assert.equal(await db.raw("diettemplates").countDocuments(), 5);
});

test("una fase por documento, con sus semanas dentro, ids conservados; la biblioteca queda limpia; idempotente", async () => {
  await db.reset();
  const ids = await seedOldFormat();
  const conn = db.mongoose.connection.db;
  await migrateDietPhases(conn);

  const [first, second] = await DietPhase.find({ clientId: ids.client }).sort({ startDate: 1 });
  assert.deepEqual(
    [first.name, first.startDate, first.endDate],
    ["Adaptación", "2026-08-03", "2026-08-16"]
  );
  assert.equal(String(first._id), String(ids.head1));
  assert.equal(first.target.kcal, 2000);
  assert.equal(first.proteinPerKg, 2);
  assert.equal(first.need.target.kcal, 2000);
  assert.equal(String(first.sourceTemplateId), String(ids.library));

  assert.equal(String(second._id), String(ids.head2));
  assert.deepEqual([second.name, second.endDate], ["Definición", null]);
  const raw2 = await db.raw("dietphases").findOne({ _id: ids.head2 });
  assert.deepEqual(["status" in raw2, "supersededBy" in raw2], [false, false], "el estado de la cadena no se guarda");
  assert.deepEqual(second.contents.map((c) => [String(c._id), c.startDate]), [[String(ids.head2), "2026-08-17"], [String(ids.week3), "2026-08-31"]]);
  const item = second.contents[1].menus[0].meals[0].alternatives[0].customProducts[0];
  assert.equal(item.product.name, "Pollo", "los alimentos se siguen poblando");
  assert.equal(item.quantity, 120);
  const raw = await db.raw("dietphases").findOne({ _id: ids.head2 });
  assert.equal(raw.contents[0].menus[0]._id, undefined, "menús sin _id");
  assert.equal(raw.contents[0].menus[0].meals[0].alternatives[0].customProducts[0].mealId, undefined);

  const loose = await DietPhase.findById(ids.loose);
  assert.deepEqual([loose.name, loose.contents.length], ["Suelto", 1], "un plan suelto es una fase de una versión");

  // La app la lee igual: menús del día y semanas.
  assert.deepEqual((await dietPhaseService.menusAt(ids.client, "2026-09-02")).map((m) => m.name), ["Único"]);
  assert.equal((await dietPhaseService.menusAt(ids.client, "2026-09-02"))[0].meals[0].alternatives[0].customProducts[0].quantity, 120);

  const library = await db.raw("diettemplates").find({}).toArray();
  assert.deepEqual(library.map((t) => String(t._id)), [String(ids.library)], "solo queda la biblioteca");
  assert.equal("clientId" in library[0], false);
  assert.equal("status" in library[0], false);
  assert.equal(library[0].menus[0]._id, undefined);
  assert.equal((await DietTemplate.findById(ids.library)).menus[0].meals[0].alternatives[0].customProducts[0].product.name, "Pollo");

  const again = await migrateDietPhases(conn);
  assert.equal(again.phases + again.removedCopies, 0);
  assert.equal(await db.raw("dietphases").countDocuments(), 3);
});
