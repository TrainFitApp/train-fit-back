const { test } = require("node:test");
const assert = require("node:assert/strict");
const { useTestDb } = require("../integration/support/db");
const User = require("../components/users/user-schema");
const DietDay = require("../components/dietDays/diet-days-schema");
const Table = require("../components/tables/table-schema");
const Workout = require("../components/workouts/workout-schema");
const Exercise = require("../components/exercises/exercise-schema");
const Product = require("../components/products/product-schema");
const Anthropometry = require("../components/anthropometry/anthropometry-schema");
const { STEPS, runMigrations, listSteps } = require("./migrate-modelo-datos");

// La cadena entera sobre una base con la forma de PRODUCCIÓN (rama main):
// wrapper `diets`, días sin dueño, comidas, alimentos, microciclos, sesiones,
// ejercicios y series en colecciones sueltas, favoritos `archived*`, peso en
// el usuario y objetivos en su propia colección. Sembrada en crudo.
const db = useTestDb({ name: "trainfit_migrate_chain" });

async function seedMainState() {
  const ids = Object.fromEntries(
    ["user", "diet", "day", "orphanDay", "meal", "cp", "table", "split", "workout", "ce", "set", "goal", "exercise"].map((name) => [name, db.oid()]),
  );
  const product = await Product.create({ name: "Avena", energyKcal100g: 380 });
  await db.raw("users").insertOne({
    _id: ids.user,
    email: "cliente@example.test",
    name: "Cliente",
    roles: ["user"],
    weight: 80,
    stepGoal: 8000,
    dietInUse: ids.diet,
    tableInUse: ids.table,
    workoutInUse: ids.workout,
    goalInUse: ids.goal,
    archivedProducts: [product._id],
    archivedRecipes: [],
    archivedExercises: [],
    archivedDiets: [],
    archivedTables: [],
    theme: "dark",
  });
  await db.raw("diets").insertOne({ _id: ids.diet, name: "Diet", dietsDay: [ids.day, db.oid()], pinnedNote: "Beber agua" });
  await db.raw("dietdays").insertMany([
    { _id: ids.day, date: "2026-01-10T08:00:00.000Z", steps: 9000, meals: [ids.meal] },
    { _id: ids.orphanDay, date: "2025-12-01", meals: [] },
  ]);
  await db.raw("meals").insertOne({ _id: ids.meal, name: "Desayuno", customProducts: [ids.cp], customRecipes: [] });
  await db.raw("customproducts").insertOne({ _id: ids.cp, product: product._id, quantity: 60, mealId: ids.meal });
  await db.raw("nutritionalgoals").insertOne({ _id: ids.goal, userId: ids.user, name: "Default", kcalTotal: 2100 });
  await db.raw("exercises").insertOne({ _id: ids.exercise, name: "Press de banca", userId: ids.user, muscleGroups1: ["Pecho"] });
  await db.raw("sets").insertOne({ _id: ids.set, reps: 8, order: 0, expectedMin: 1, expectedSec: 30 });
  await db.raw("customexercises").insertOne({ _id: ids.ce, exercise: ids.exercise, order: 0, sets: [ids.set] });
  await db.raw("workouts").insertOne({ _id: ids.workout, name: "Empuje", exercises: [ids.ce] });
  await db.raw("splits").insertOne({ _id: ids.split, name: "Semana 1", workouts: [ids.workout] });
  await db.raw("tables").insertOne({ _id: ids.table, name: "Rutina", userId: ids.user, splits: [ids.split] });
  return { ...ids, product: product._id };
}

const collectionNames = async () =>
  (await db.mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);

test("de la forma de main al modelo final en una pasada; la segunda no hace nada; --drop-old borra lo viejo", async () => {
  await db.reset();
  const ids = await seedMainState();
  const conn = db.mongoose.connection.db;

  const first = await runMigrations(conn);
  assert.deepEqual(first.map((result) => result.id), STEPS.map((step) => step.id));

  // Diario: el día tiene dueño, fecha corta y la comida con su alimento dentro.
  const day = await DietDay.findOne({ userId: ids.user, date: "2026-01-10" }).lean();
  assert.ok(day, "el día pasa a ser del usuario con la fecha normalizada");
  assert.equal(String(day.meals[0].customProducts[0].product), String(ids.product));
  assert.equal(day.meals[0].customProducts[0].mealId, undefined);
  assert.equal((await db.raw("dietdays").findOne({ _id: ids.day })).steps, undefined, "dietdays.steps desaparece");

  // Usuario: nota, favoritos, objetivo embebido y fuera todo lo retirado.
  const user = await User.findById(ids.user).lean();
  assert.equal(user.dietPinnedNote, "Beber agua");
  assert.deepEqual(user.favorites.products.map(String), [String(ids.product)]);
  assert.equal(String(user.nutritionalGoals[0]._id), String(ids.goal));
  assert.equal(String(user.goalInUse), String(ids.goal));
  const raw = await db.raw("users").findOne({ _id: ids.user });
  for (const field of ["weight", "stepGoal", "dietInUse", "archivedProducts", "archivedDiets", "archivedTables"]) {
    assert.equal(raw[field], undefined, `users.${field} desaparece`);
  }
  assert.equal((await Anthropometry.findOne({ userId: ids.user }).lean())?.weight, 80, "el peso pasa a sus medidas");

  // Entrenamiento: microciclos dentro de la rutina, series dentro de la sesión.
  const table = await Table.findById(ids.table).lean();
  assert.equal(String(table.splits[0].workouts[0]), String(ids.workout));
  const workout = await Workout.findById(ids.workout).lean();
  assert.equal(workout.kind, "session");
  assert.equal(workout.exercises[0].sets[0].reps, 8);
  assert.equal(workout.exercises[0].sets[0].expectedTime, "1:30");
  const exercise = await db.raw("exercises").findOne({ _id: ids.exercise });
  assert.equal(exercise.muscleGroups1, undefined);
  assert.ok((await Exercise.findById(ids.exercise).lean()).muscles.length, "los grupos viejos se traducen");

  // Segunda pasada: solo lo que va siempre.
  const second = await runMigrations(conn);
  assert.deepEqual(second.map((result) => result.id), STEPS.filter((step) => step.always).map((step) => step.id));
  assert.ok((await listSteps(conn)).every((step) => step.appliedAt));

  // Con --drop-old desaparecen las colecciones viejas.
  await runMigrations(conn, { dropOld: true });
  const left = await collectionNames();
  for (const name of ["diets", "meals", "customproducts", "sets", "customexercises", "splits", "nutritionalgoals"]) {
    assert.ok(!left.includes(name), `${name} se borra`);
  }
  assert.ok(await DietDay.exists({ userId: ids.user }), "el diario sigue ahí");
  assert.equal(await db.raw("dietdays").countDocuments({ _id: ids.orphanDay }), 0, "el día sin dueño se borra");
});

test("--dry-run no escribe nada ni apunta pasos", async () => {
  await db.reset();
  await db.raw("schemamigrations").deleteMany({});
  const ids = await seedMainState();
  const conn = db.mongoose.connection.db;
  await runMigrations(conn, { dryRun: true });
  assert.equal(await db.raw("schemamigrations").countDocuments(), 0);
  assert.equal((await db.raw("dietdays").findOne({ _id: ids.day })).userId, undefined);
  assert.ok((await collectionNames()).includes("diets"));
});
