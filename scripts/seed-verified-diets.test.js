const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const { buildMenus, dietFoodKeys, dietaryFlags, menuMacros, planSeed, seedVerifiedDiets } = require("./seed-verified-diets");
const { DIETS, PANTRY } = require("./data/verified-diets");
const SNAPSHOT = require("./data/verified-diets/macros-snapshot");
const { MEALS } = require("../components/dietDays/diet-days-util");
const { MAX_ALTERNATIVES } = require("../components/dietTemplates/diet-menus");
const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
const { contentMacroProfile } = require("../components/dietTemplates/diet-macro-profile");

const db = useTestDb();

const SLOTS = new Set(Object.values(MEALS));
const snapshotProducts = new Map(Object.entries(SNAPSHOT));

// ─── Datos ─────────────────────────────────────────────────────────────

test("el número del nombre («Definición · 1.600 kcal») es la media de sus menús (±5 %)", () => {
  for (const diet of DIETS) {
    const named = Number((diet.name.match(/([\d.]+)\s*kcal/) || [])[1]?.replace(".", ""));
    assert.ok(named > 0, `"${diet.name}": el nombre dice sus kcal`);
    const average = diet.menus.reduce((sum, menu) => sum + menuMacros(menu, snapshotProducts).kcal, 0) / diet.menus.length;
    assert.ok(Math.abs(average / named - 1) <= 0.05, `"${diet.name}": la media de sus menús es ${Math.round(average)} kcal`);
  }
});

test("las dietas tienen nombre único y caben en el schema", () => {
  const names = DIETS.map((diet) => diet.name.trim().toLowerCase());
  assert.equal(new Set(names).size, names.length, "nombre de dieta repetido");
  for (const diet of DIETS) {
    assert.ok(diet.name.length <= 100, `"${diet.name}": nombre de más de 100 caracteres`);
    const menuNames = diet.menus.map((menu) => menu.name);
    assert.equal(new Set(menuNames).size, menuNames.length, `"${diet.name}": dos menús con el mismo nombre`);
    for (const menu of diet.menus) {
      const where = `${diet.name} › ${menu.name}`;
      assert.ok(menu.name.length <= 50, `${where}: nombre de menú de más de 50 caracteres`);
      assert.ok(menu.target.kcal > 0 && menu.target.protein > 0, `${where}: sin objetivo`);
      const slots = menu.meals.map((meal) => meal.slot);
      assert.equal(new Set(slots).size, slots.length, `${where}: hueco repetido`);
      for (const meal of menu.meals) {
        assert.ok(SLOTS.has(meal.slot), `${where}: hueco "${meal.slot}" no existe`);
        assert.ok(meal.alternatives.length >= 1 && meal.alternatives.length <= MAX_ALTERNATIVES, `${where} › ${meal.slot}: de 1 a 4 opciones`);
        for (const alternative of meal.alternatives) {
          const label = `${where} › ${alternative.label}`;
          assert.ok(alternative.label && alternative.label.length <= 100, `${label}: etiqueta de 1 a 100 caracteres`);
          const keys = alternative.foods.map(([key]) => key);
          assert.equal(new Set(keys).size, keys.length, `${label}: alimento repetido`);
          for (const [key, grams] of alternative.foods) {
            assert.ok(PANTRY[key], `${label}: "${key}" no está en la despensa`);
            assert.ok(Number.isInteger(grams) && grams > 0 && grams <= 1000 && grams % 5 === 0, `${label}: cantidad de "${key}"`);
          }
        }
      }
    }
  }
});

test("cada menú cuadra con su objetivo de energía y proteína", () => {
  for (const diet of DIETS) {
    for (const menu of diet.menus) {
      const macros = menuMacros(menu, snapshotProducts);
      const where = `${diet.name} › ${menu.name}: ${macros.kcal} kcal y ${macros.protein} g`;
      assert.ok(Math.abs(macros.kcal / menu.target.kcal - 1) <= 0.03, `${where} frente a ${menu.target.kcal} kcal`);
      assert.ok(Math.abs(macros.protein / menu.target.protein - 1) <= 0.05, `${where} frente a ${menu.target.protein} g`);
    }
  }
});

test("las opciones de una comida son equivalentes", () => {
  for (const diet of DIETS) {
    for (const menu of diet.menus) {
      for (const meal of menu.meals) {
        const options = meal.alternatives.map((alternative) => ({
          label: alternative.label,
          ...menuMacros({ meals: [{ alternatives: [alternative] }] }, snapshotProducts),
        }));
        const mean = (field) => options.reduce((sum, option) => sum + option[field], 0) / options.length;
        for (const option of options) {
          const where = `${diet.name} › ${menu.name} › ${meal.slot} › ${option.label}`;
          assert.ok(Math.abs(option.kcal / mean("kcal") - 1) <= 0.12, `${where}: ${option.kcal} kcal frente a ${Math.round(mean("kcal"))}`);
          assert.ok(Math.abs(option.protein / mean("protein") - 1) <= 0.1, `${where}: ${option.protein} g frente a ${Math.round(mean("protein"))}`);
        }
      }
    }
  }
});

test("las dietas vegetariana y vegana lo son de verdad", () => {
  const byName = (prefix) => DIETS.find((diet) => diet.name.startsWith(prefix));
  assert.deepEqual(dietaryFlags(byName("Vegana")), ["vegan", "vegetarian"]);
  assert.deepEqual(dietaryFlags(byName("Vegetariana")), ["vegetarian"]);
  assert.deepEqual(dietaryFlags(byName("Definición · 1.600")), []);
});

test("la instantánea de valores cubre justo los alimentos que se usan", () => {
  const used = [...new Set(DIETS.flatMap(dietFoodKeys))].sort();
  assert.deepEqual(Object.keys(SNAPSHOT).sort(), used);
});

// ─── Lógica pura ───────────────────────────────────────────────────────

const pantry = {
  avena: { product: "6928f4bbcdbf40e64b9de131", code: "1", kind: "vegetal" },
  yogur: { product: "6928f4bbcdbf40e64b9ddf71", code: "2", kind: "lacteo" },
  pollo: { product: "6928f4bccdbf40e64b9df14a", code: "3", kind: "carne" },
};
const diet = (...foods) => ({ name: "D", menus: [{ name: "M", meals: [{ slot: "Comida", alternatives: [{ label: "A", foods }] }] }] });

test("deduce vegetariana y vegana de lo que lleva", () => {
  assert.deepEqual(dietaryFlags(diet(["avena", 50]), pantry), ["vegan", "vegetarian"]);
  assert.deepEqual(dietaryFlags(diet(["avena", 50], ["yogur", 125]), pantry), ["vegetarian"]);
  assert.deepEqual(dietaryFlags(diet(["avena", 50], ["pollo", 100]), pantry), []);
});

test("construye los menús como los manda el constructor de plantillas", () => {
  const [menu] = buildMenus(diet(["avena", 50], ["yogur", 125]), pantry);
  assert.equal(menu.name, "M");
  const [alternative] = menu.meals[0].alternatives;
  assert.equal(alternative.label, "A");
  assert.deepEqual(alternative.customRecipes, []);
  assert.deepEqual(
    alternative.customProducts.map(({ product, quantity, order }) => [String(product), quantity, order]),
    [[pantry.avena.product, 50, 0], [pantry.yogur.product, 125, 1]],
  );
});

test("cada comida cuenta la media de sus opciones", () => {
  const products = new Map([
    ["avena", { energyKcal100g: 400, protein100g: 10, carbohydrates100g: 60, fat100g: 8 }],
    ["pollo", { energyKcal100g: 100, protein100g: 20, carbohydrates100g: 0, fat100g: 2 }],
  ]);
  const menu = {
    meals: [
      { alternatives: [{ foods: [["avena", 50]] }, { foods: [["pollo", 100]] }] },
      { alternatives: [{ foods: [["pollo", 200]] }] },
    ],
  };
  // (200 + 100) / 2 + 200 kcal; (5 + 20) / 2 + 40 g de proteína.
  assert.deepEqual(menuMacros(menu, products), { kcal: 350, protein: 53, carbs: 15, fat: 7 });
});

test("planifica: crea lo que falta, respeta lo que existe y bloquea lo que no tiene productos", () => {
  const named = (name, ...keys) => ({ ...diet(...keys.map((key) => [key, 100])), name });
  const plan = planSeed({
    diets: [named("A", "avena"), named("B", "avena", "pollo"), named("C", "yogur")],
    availableKeys: new Set(["avena", "yogur"]),
    existingNames: new Set(["C"]),
  });
  assert.deepEqual(plan.toCreate.map((item) => item.name), ["A"]);
  assert.deepEqual(plan.existing.map((item) => item.name), ["C"]);
  assert.deepEqual(plan.blocked.map(({ diet: item, missingKeys }) => [item.name, missingKeys]), [["B", ["pollo"]]]);
});

// ─── Contra la base de datos ───────────────────────────────────────────

// Los productos de la despensa con su _id, su código y los valores de la
// instantánea (los que no usan las dietas, con valores de relleno).
async function seedPantryProducts({ skip = [] } = {}) {
  const docs = Object.entries(PANTRY)
    .filter(([key]) => !skip.includes(key))
    .map(([key, entry]) => ({
      _id: db.oid(entry.product),
      code: entry.code,
      name: entry.name,
      ...(SNAPSHOT[key] || { energyKcal100g: 100, protein100g: 1, carbohydrates100g: 10, fat100g: 1 }),
    }));
  await db.raw("products").insertMany(docs);
}

async function seedAdmin(email = "admin@trainfit.net") {
  const _id = db.oid();
  await db.raw("users").insertOne({ _id, email, roles: ["admin"] });
  return _id;
}

const factoryCount = () => db.raw("diettemplates").countDocuments({ verified: true });

test("siembra todas las dietas de fábrica firmadas por un admin", async () => {
  await db.reset();
  await seedPantryProducts();
  await db.raw("users").insertOne({ _id: db.oid(), email: "trainer@trainfit.net", roles: ["trainer"] });
  const adminId = await seedAdmin();

  const stats = await seedVerifiedDiets();
  assert.deepEqual(stats, { diets: DIETS.length, created: DIETS.length, toCreate: DIETS.length, existing: 0, blocked: 0, missingProducts: 0 });
  assert.equal(await factoryCount(), DIETS.length);

  const vegan = await db.raw("diettemplates").findOne({ name: "Vegana · 2.200 kcal" });
  assert.equal(String(vegan.trainerId), String(adminId));
  assert.equal(vegan.ownerClientId, null);
  assert.deepEqual(vegan.suitableForOverride, ["vegan", "vegetarian"]);
  const source = DIETS.find((item) => item.name === vegan.name);
  assert.deepEqual(vegan.menus.map((menu) => menu.name), source.menus.map((menu) => menu.name));
  const firstOption = vegan.menus[0].meals[0].alternatives[0];
  assert.equal(firstOption.label, source.menus[0].meals[0].alternatives[0].label);
  // Cada alimento es el genérico en español de su clave, con los valores
  // del producto de referencia (QA 2026-10-09, M8: salían productos de EE. UU.
  // en inglés y con marca).
  const sourceFoods = source.menus[0].meals[0].alternatives[0].foods;
  const generics = await db.raw("products").find({ _id: { $in: firstOption.customProducts.map((item) => item.product) } }).toArray();
  const genericById = new Map(generics.map((product) => [String(product._id), product]));
  assert.deepEqual(
    firstOption.customProducts.map(({ product, quantity }) => [genericById.get(String(product))?.name, quantity]),
    sourceFoods.map(([key, grams]) => [PANTRY[key].label, grams]),
  );
  for (const [key] of sourceFoods) {
    const generic = generics.find((product) => product.name === PANTRY[key].label);
    assert.equal(generic.verified, true);
    assert.equal(generic.userId, null);
    assert.equal(generic.code ?? null, null, "sin código de barras");
    assert.equal(generic.energyKcal100g, (SNAPSHOT[key] || { energyKcal100g: 100 }).energyKcal100g, "valores del de referencia");
    assert.equal(generic.vegan, true, "lo vegetal es vegano");
    assert.equal(generic.lactoseFree, true);
  }
  assert.ok(firstOption.customProducts.every((item) => item._id), "cada alimento lleva su _id");
  assert.equal(vegan.suitableFor.includes("lactoseFree"), true, "la vegana cumple «Sin lactosa»");

  const otherTrainer = db.oid();
  const suggested = await dietTemplateDao.listRankableForClient(otherTrainer, db.oid(), ["verified"]);
  assert.equal(suggested.length, DIETS.length, "salen en las sugerencias de cualquier profesional");
  const profile = contentMacroProfile(suggested.find((item) => item.name === "Definición · 2.000 kcal").toObject());
  assert.ok(Math.abs(profile.kcal - 2000) <= 60, `el perfil del cajón ronda las 2.000 kcal (${profile.kcal})`);
});

test("--owner elige el admin y rechaza a quien no lo es", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedAdmin("primero@trainfit.net");
  const chosen = await seedAdmin("elegido@trainfit.net");
  await db.raw("users").insertOne({ _id: db.oid(), email: "trainer@trainfit.net", roles: ["trainer"] });

  await assert.rejects(seedVerifiedDiets({ ownerEmail: "trainer@trainfit.net" }), /no es admin/);
  await assert.rejects(seedVerifiedDiets({ ownerEmail: "nadie@trainfit.net" }), /No hay ningún usuario/);
  assert.equal(await factoryCount(), 0);

  await seedVerifiedDiets({ ownerEmail: "Elegido@TrainFit.net" });
  assert.equal(await db.raw("diettemplates").countDocuments({ trainerId: chosen }), DIETS.length);
});

test("sin ningún admin no escribe nada", async () => {
  await db.reset();
  await seedPantryProducts();
  await assert.rejects(seedVerifiedDiets(), /ningún admin/);
  assert.equal(await factoryCount(), 0);
});

test("es idempotente: una segunda pasada no crea ni toca nada", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedAdmin();
  await seedVerifiedDiets();
  const before = await db.raw("diettemplates").findOne({ name: "Definición · 1.600 kcal" });

  const stats = await seedVerifiedDiets();
  assert.equal(stats.created, 0);
  assert.equal(stats.existing, DIETS.length);
  assert.equal(await factoryCount(), DIETS.length);
  assert.deepEqual(await db.raw("diettemplates").findOne({ name: "Definición · 1.600 kcal" }), before);
});

test("una plantilla de un profesional con el mismo nombre no cuenta como existente", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedAdmin();
  await db.raw("diettemplates").insertOne({ name: "Definición · 1.600 kcal", trainerId: db.oid(), verified: false, menus: [] });

  const stats = await seedVerifiedDiets();
  assert.equal(stats.created, DIETS.length);
  assert.equal(await db.raw("diettemplates").countDocuments({ name: "Definición · 1.600 kcal" }), 2);
});

test("--dry-run informa sin escribir", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedAdmin();
  const lines = [];

  const stats = await seedVerifiedDiets({ dryRun: true, log: (line) => lines.push(line) });
  assert.equal(stats.toCreate, DIETS.length);
  assert.equal(stats.created, 0);
  assert.equal(await db.raw("diettemplates").countDocuments({}), 0);
  assert.ok(lines.some((line) => line.includes("Día de entreno:") && line.includes("objetivo 1700 kcal")));
  assert.ok(!lines.some((line) => line.includes("se aleja")), "con los valores de la instantánea ningún menú se desvía");
});

test("sin un producto, solo se quedan fuera las dietas que lo usan", async () => {
  await db.reset();
  await seedPantryProducts({ skip: ["salmon"] });
  await seedAdmin();
  const lines = [];

  const stats = await seedVerifiedDiets({ log: (line) => lines.push(line) });
  const withSalmon = DIETS.filter((item) => dietFoodKeys(item).includes("salmon"));
  assert.ok(withSalmon.length > 0);
  assert.equal(stats.blocked, withSalmon.length);
  assert.equal(stats.missingProducts, 1);
  assert.equal(await factoryCount(), DIETS.length - withSalmon.length);
  assert.ok(lines.some((line) => line.includes('falta el producto de "salmon"')));
});

test("no escribe nada si la base sigue en el modelo viejo", async () => {
  await db.reset();
  await seedPantryProducts();
  await seedAdmin();
  await db.raw("diettemplates").insertOne({
    name: "Vieja",
    trainerId: db.oid(),
    menus: [{ name: "M", meals: [{ slot: "Comida", alternatives: [{ customProducts: [db.oid()] }] }] }],
  });

  await assert.rejects(seedVerifiedDiets(), /npm run migrate\./);
  assert.equal(await db.raw("diettemplates").countDocuments({}), 1);
});
