const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Long } = require("mongoose").mongo;
const { useTestDb } = require("../../integration/support/db");
const Workout = require("../../components/workouts/workout-schema");
const Table = require("../../components/tables/table-schema");
const Recipe = require("../../components/recipes/recipe-schema");
const Product = require("../../components/products/product-schema");
const { migrateOutOfRangeValues } = require("./26-out-of-range-values");

const db = useTestDb();

// Los casos que aparecieron en la copia de PRO.
async function seed() {
  await db.reset();
  const ids = Object.fromEntries(
    ["workout", "goodWorkout", "table", "recipe", "product", "hugeProduct", "goodProduct", "exercise", "set", "looseRir", "goodSet"].map((key) => [
      key,
      db.oid(),
    ]),
  );
  const goodSet = { _id: ids.goodSet, reps: 8, weight: 100, rir: [2], doned: true };
  await db.raw("workouts").insertMany([
    {
      _id: ids.workout,
      kind: "session",
      name: "Pierna",
      exercises: [
        {
          _id: db.oid(),
          exercise: ids.exercise,
          order: 0,
          sets: [
            { _id: ids.set, velocity: 901, rir: [999, 2], expectedRir: [68], reps: 41444522222, weight: 10875, restPause: 2222222, doned: true },
            goodSet,
            { _id: ids.looseRir, reps: 5, rir: 909865 },
          ],
        },
      ],
      __v: 2,
    },
    { _id: ids.goodWorkout, kind: "session", name: "Empuje", exercises: [{ _id: db.oid(), exercise: ids.exercise, order: 0, sets: [goodSet] }], __v: 0 },
  ]);
  await db.raw("tables").insertOne({
    _id: ids.table,
    name: "Rutina",
    splits: [],
    pinnedNotes: [
      { _id: db.oid(), workoutIndex: 0, exerciseIndex: 0, notes: "" },
      { _id: db.oid(), workoutIndex: 0, exerciseIndex: 1, notes: "Codos pegados" },
    ],
    __v: 0,
  });
  await db.raw("recipes").insertOne({
    _id: ids.recipe,
    name: "Guiso",
    customProducts: [
      { _id: db.oid(), quantity: 111800, energyKcal100g: 100 },
      { _id: db.oid(), quantity: 500000000, energyKcal100g: 100 },
      { _id: db.oid(), quantity: 200, energyKcal100g: 100 },
    ],
    __v: 0,
  });
  await db.raw("products").insertMany([
    {
      _id: ids.product,
      name: "Atún",
      brand: "b".repeat(619),
      ingredients: "i".repeat(6701),
      traces: ["t".repeat(300), "Soja"],
      vitaminC100g: -0.0000075,
      protein100g: -12.6,
      energyKcal100g: 14200000000000000,
      fat100g: 1.2,
    },
    // Más de 53 bits: la base lo guarda como Long y el driver no lo devuelve como number.
    { _id: ids.hugeProduct, name: "Galleta", energyKcal100g: Long.fromString("4554519161664950000") },
    { _id: ids.goodProduct, name: "Pollo", energyKcal100g: 120, protein100g: 23 },
  ]);
  return ids;
}

const find = (collection, _id) => db.raw(collection).findOne({ _id });

test("deja cada documento dentro de su schema sin tocar lo que ya cabía", async () => {
  const ids = await seed();

  const stats = await migrateOutOfRangeValues(db.mongoose.connection.db);
  assert.deepEqual(stats, { workouts: 1, tables: 1, recipes: 1, recipeQuantitiesLeft: 1, products: 2 });

  const workout = await find("workouts", ids.workout);
  const [set, good, loose] = workout.exercises[0].sets;
  assert.equal(set.velocity, 0.901, "la velocidad en mm/s pasa a m/s");
  assert.deepEqual(set.rir, [null, 2], "el RIR imposible queda «—» sin mover los demás");
  assert.deepEqual(set.expectedRir, [null]);
  for (const field of ["reps", "weight", "restPause"]) assert.equal(field in set, false, `${field} imposible se vacía`);
  assert.equal(set.doned, true, "lo hecho se conserva");
  assert.deepEqual(good, { _id: ids.goodSet, reps: 8, weight: 100, rir: [2], doned: true });
  assert.deepEqual(loose.rir, [null], "un RIR suelto también: mongoose lo lee como lista de uno");
  assert.equal(workout.__v, 3, "sube la versión para la concurrencia optimista");
  assert.equal((await find("workouts", ids.goodWorkout)).__v, 0, "un entrenamiento correcto no se toca");
  assert.equal(new Workout(workout).validateSync(), undefined);

  const table = await find("tables", ids.table);
  assert.deepEqual(table.pinnedNotes.map((note) => note.notes), ["Codos pegados"]);
  assert.equal(new Table(table).validateSync(), undefined);

  const recipe = await find("recipes", ids.recipe);
  assert.deepEqual(recipe.customProducts.map((item) => item.quantity), [111.8, 500000000, 200], "lo que ni así cabe se deja");

  const product = await find("products", ids.product);
  assert.equal(product.vitaminC100g, 0, "un negativo de redondeo es 0");
  assert.equal("protein100g" in product, false);
  assert.equal("energyKcal100g" in product, false);
  assert.equal(product.fat100g, 1.2);
  assert.equal(product.brand.length, 200);
  assert.equal(product.ingredients.length, 5000);
  assert.deepEqual(product.traces.map((item) => item.length), [200, 4]);
  assert.equal(new Product(product).validateSync(), undefined);
  assert.equal("energyKcal100g" in (await find("products", ids.hugeProduct)), false);
  assert.deepEqual(await find("products", ids.goodProduct), { _id: ids.goodProduct, name: "Pollo", energyKcal100g: 120, protein100g: 23 });

  // La receta con la cantidad que no se puede arreglar sigue sin pasar: se cuenta en el informe.
  assert.ok(new Recipe(recipe).validateSync());
});

test("es idempotente y --dry-run no escribe nada", async () => {
  const ids = await seed();
  const nativeDb = db.mongoose.connection.db;

  const dry = await migrateOutOfRangeValues(nativeDb, { dryRun: true });
  assert.deepEqual(dry, { workouts: 1, tables: 1, recipes: 1, recipeQuantitiesLeft: 1, products: 2 });
  assert.equal((await find("workouts", ids.workout)).exercises[0].sets[0].velocity, 901, "dry-run: sin cambios");
  assert.equal((await find("products", ids.product)).protein100g, -12.6);

  await migrateOutOfRangeValues(nativeDb);
  assert.deepEqual(await migrateOutOfRangeValues(nativeDb), { workouts: 0, tables: 0, recipes: 0, recipeQuantitiesLeft: 1, products: 0 });
});
