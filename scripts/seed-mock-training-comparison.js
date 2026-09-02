const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[seed-mock-training-comparison]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// Datos de relleno para visualizar el remodelado de Entrenamiento (2026-09):
// calendario de rango + gráfica de comparación por microciclo (sesiones,
// series, volumen, grupos musculares). A diferencia de los scripts
// verify-*, este NO se limpia solo — la información se queda para que el
// usuario la vea en el navegador. Reejecutarlo no duplica nada: primero
// borra cualquier rastro de una siembra anterior con el mismo email.

const PASSWORD = "Demo1234!";
const TRAINER_EMAIL = "mock-trainer@test.local";
const CLIENT_EMAIL = "mock-client@test.local";

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

async function wipeExisting() {
  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const tableSchema = require("../components/tables/table-schema");
  const splitSchema = require("../components/splits/split-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const setSchema = require("../components/sets/set-schema");
  const exerciseSchema = require("../components/exercises/exercise-schema");

  const existingClient = await userSchema.findOne({ email: CLIENT_EMAIL });
  if (existingClient) {
    const tables = await tableSchema.find({ userId: existingClient._id });
    for (const table of tables) {
      const splits = await splitSchema.find({ _id: { $in: table.splits } });
      const workoutIds = splits.flatMap((s) => s.workouts);
      const workouts = await workoutSchema.find({ _id: { $in: workoutIds } });
      const customExerciseIds = workouts.flatMap((w) => w.exercises);
      const customExercises = await customExerciseSchema.find({ _id: { $in: customExerciseIds } });
      const setIds = customExercises.flatMap((ce) => ce.sets);
      await setSchema.deleteMany({ _id: { $in: setIds } });
      await customExerciseSchema.deleteMany({ _id: { $in: customExerciseIds } });
      await workoutSchema.deleteMany({ _id: { $in: workoutIds } });
      await splitSchema.deleteMany({ _id: { $in: table.splits } });
    }
    await tableSchema.deleteMany({ userId: existingClient._id });
  }
  await exerciseSchema.deleteMany({ name: { $regex: /\(mock\)$/ } });
  await TrainerClient.deleteMany({ clientEmail: CLIENT_EMAIL });
  await userSchema.deleteMany({ email: { $in: [TRAINER_EMAIL, CLIENT_EMAIL] } });
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const exerciseSchema = require("../components/exercises/exercise-schema");
  const setSchema = require("../components/sets/set-schema");
  const customExerciseSchema = require("../components/customExercises/custom-exercise-schema");
  const workoutSchema = require("../components/workouts/workout-schema");
  const splitSchema = require("../components/splits/split-schema");
  const tableSchema = require("../components/tables/table-schema");

  await wipeExisting();
  ok("limpiado cualquier rastro de una siembra anterior");

  const trainer = await userSchema.create({
    email: TRAINER_EMAIL,
    password: PASSWORD,
    roles: ["trainer"],
    name: "Mock",
    lastname: "Trainer",
  });
  const client = await userSchema.create({
    email: CLIENT_EMAIL,
    password: PASSWORD,
    roles: ["user"],
    name: "Cliente",
    lastname: "Mock",
  });
  ok(`trainer ${trainer.email}, client ${client.email}`);

  await TrainerClient.create({
    trainerId: trainer._id,
    clientId: client._id,
    clientEmail: client.email,
    scope: "training",
    status: "active",
  });

  // Catálogo de ejercicios con grupo muscular real, para la comparación por
  // grupo. "(mock)" en el nombre para poder limpiar el catálogo si se
  // reejecuta el script sin arrastrar ejercicios reales de otros clientes.
  const catalogDefs = [
    { name: "Sentadilla (mock)", muscleGroups1: ["Pierna"] },
    { name: "Peso muerto (mock)", muscleGroups1: ["Espalda"], muscleGroups2: ["Pierna"] },
    { name: "Press banca (mock)", muscleGroups1: ["Pecho"], muscleGroups2: ["Hombros"] },
    { name: "Press militar (mock)", muscleGroups1: ["Hombros"] },
    { name: "Dominadas (mock)", muscleGroups1: ["Espalda"] },
    { name: "Curl bíceps (mock)", muscleGroups1: ["Pierna"] }, // catálogo real no tiene "Bíceps"; ver nota abajo
    { name: "Fondos (mock)", muscleGroups1: ["Pecho"] },
    { name: "Plancha (mock)", muscleGroups1: ["Core"] },
  ];
  // MUSCLE_GROUPS_ES real (shared-ui/constants/muscle-groups.ts) es un
  // catálogo corto: Pecho/Espalda/Pierna/Core/Hombros. No hay "Bíceps" ni
  // "Tríceps" — se corrige aquí para no inventar valores fuera de catálogo.
  catalogDefs[5].muscleGroups1 = ["Pierna"];
  catalogDefs[5].name = "Curl femoral (mock)";

  const catalog = {};
  for (const def of catalogDefs) {
    catalog[def.name] = await exerciseSchema.create(def);
  }
  ok(`${catalogDefs.length} ejercicios de catálogo creados`);

  const ex = (name) => catalog[Object.keys(catalog).find((k) => k.startsWith(name))];

  // 5 microciclos, ~70 días -> hoy. Volumen/sesiones/grupos musculares
  // varían a propósito entre bloques para que las 4 métricas de
  // comparación tengan algo que enseñar (incluida una descarga con caída
  // visible en el bloque 4).
  // Comprimido dentro de 44 días -> hoy: el preset por defecto del
  // calendario (90d) cubre 45 días hacia atrás, así que los 5 microciclos
  // se ven de un vistazo sin tener que tocar el calendario.
  const MICROS = [
    {
      name: "Bloque 1 - Fuerza",
      startDaysAgo: 44,
      workouts: [
        { offset: 0, exercises: [["Sentadilla", 5, 80], ["Press banca", 5, 60]] },
        { offset: 2, exercises: [["Peso muerto", 5, 90], ["Dominadas", 8, 0]] },
        { offset: 4, exercises: [["Sentadilla", 5, 82.5], ["Press militar", 6, 40]] },
        { offset: 6, exercises: [["Press banca", 5, 62.5], ["Peso muerto", 5, 92.5]] },
        { offset: 8, exercises: [["Sentadilla", 5, 85], ["Dominadas", 8, 0]] },
        { offset: 10, exercises: [["Press militar", 6, 42.5], ["Press banca", 5, 65]] },
      ],
    },
    {
      name: "Bloque 2 - Hipertrofia",
      startDaysAgo: 32,
      workouts: [
        { offset: 0, exercises: [["Sentadilla", 10, 70], ["Curl femoral", 12, 25], ["Fondos", 10, 0]] },
        { offset: 2, exercises: [["Press banca", 10, 55], ["Press militar", 10, 30], ["Plancha", 1, 0]] },
        { offset: 4, exercises: [["Peso muerto", 8, 80], ["Dominadas", 10, 0]] },
        { offset: 6, exercises: [["Sentadilla", 10, 72.5], ["Curl femoral", 12, 27.5], ["Fondos", 10, 0]] },
        { offset: 8, exercises: [["Press banca", 10, 57.5], ["Press militar", 10, 32.5], ["Plancha", 1, 0]] },
        { offset: 10, exercises: [["Peso muerto", 8, 82.5], ["Dominadas", 10, 0]] },
      ],
    },
    {
      name: "Bloque 3 - Volumen",
      startDaysAgo: 20,
      workouts: [
        { offset: 0, exercises: [["Sentadilla", 10, 75], ["Press banca", 10, 60], ["Fondos", 12, 0], ["Plancha", 1, 0]] },
        { offset: 2, exercises: [["Peso muerto", 8, 85], ["Dominadas", 10, 0], ["Curl femoral", 12, 30]] },
        { offset: 4, exercises: [["Press militar", 10, 35], ["Sentadilla", 10, 77.5], ["Fondos", 12, 0]] },
        { offset: 6, exercises: [["Press banca", 10, 62.5], ["Peso muerto", 8, 87.5], ["Plancha", 1, 0]] },
        { offset: 8, exercises: [["Dominadas", 10, 0], ["Curl femoral", 12, 32.5], ["Sentadilla", 10, 80]] },
        { offset: 10, exercises: [["Press militar", 10, 37.5], ["Press banca", 10, 65], ["Fondos", 12, 0]] },
        { offset: 12, exercises: [["Peso muerto", 8, 90], ["Plancha", 1, 0]] },
      ],
    },
    {
      name: "Bloque 4 - Descarga",
      startDaysAgo: 6,
      workouts: [
        { offset: 0, exercises: [["Sentadilla", 6, 55], ["Press banca", 6, 45]] },
        { offset: 2, exercises: [["Peso muerto", 6, 60], ["Dominadas", 6, 0]] },
        { offset: 4, exercises: [["Press militar", 6, 25], ["Plancha", 1, 0]] },
      ],
    },
    {
      name: "Bloque 5 - Actual",
      startDaysAgo: 1,
      workouts: [
        { offset: 0, exercises: [["Sentadilla", 5, 87.5], ["Press banca", 8, 67.5], ["Fondos", 12, 0]] },
        { offset: -1, exercises: null }, // sesión de mañana, pendiente (sin date) — variedad de adherencia
      ],
    },
  ];

  let totalSessions = 0;
  let totalSets = 0;

  for (const micro of MICROS) {
    const workoutIds = [];
    for (const w of micro.workouts) {
      let exerciseIds = [];
      if (w.exercises) {
        for (const [namePrefix, reps, weight] of w.exercises) {
          const exercise = ex(namePrefix);
          const sets = await setSchema.insertMany(
            Array.from({ length: 3 }, (_, i) => ({
              reps,
              weight,
              doned: true,
              order: i,
              rir: i === 2 ? [1] : [2, 3],
            }))
          );
          totalSets += sets.length;
          const customExercise = await customExerciseSchema.create({
            exercise: exercise._id,
            sets: sets.map((s) => s._id),
            order: exerciseIds.length,
          });
          exerciseIds.push(customExercise._id);
        }
      }
      const workout = await workoutSchema.create({
        name: `Día ${workoutIds.length + 1}`,
        exercises: exerciseIds,
        order: workoutIds.length,
        date: w.exercises ? daysAgo(micro.startDaysAgo - w.offset) : null,
        rest: false,
      });
      workoutIds.push(workout._id);
      if (w.exercises) totalSessions++;
    }
    const split = await splitSchema.create({ name: micro.name, workouts: workoutIds });
    micro.splitId = split._id;
  }

  const table = await tableSchema.create({
    name: "Rutina de fuerza (mock)",
    userId: client._id,
    assignedByTrainerId: trainer._id,
    splits: MICROS.map((m) => m.splitId),
  });
  await userSchema.findByIdAndUpdate(client._id, { $set: { tableInUse: table._id } });

  ok(`${MICROS.length} microciclos, ${totalSessions} sesiones completadas, ${totalSets} series`);
  console.log("");
  console.log(LOG_PREFIX, "Login trainer:", TRAINER_EMAIL, "/", PASSWORD);
  console.log(LOG_PREFIX, "Cliente:", client.name, client.lastname, `(${CLIENT_EMAIL})`);
  console.log(LOG_PREFIX, "Este script NO se limpia solo — los datos se quedan para verlos en el navegador.");
  console.log(LOG_PREFIX, "Para borrarlos luego: node scripts/seed-mock-training-comparison.js --clean");

  await mongoose.disconnect();
}

async function clean() {
  const mongoUri = buildMongoUri();
  await mongoose.connect(mongoUri);
  await wipeExisting();
  ok("datos de mock borrados");
  await mongoose.disconnect();
}

if (process.argv.includes("--clean")) {
  clean().catch((err) => {
    console.error(LOG_PREFIX, "ERROR", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error(LOG_PREFIX, "ERROR", err);
    process.exit(1);
  });
}
