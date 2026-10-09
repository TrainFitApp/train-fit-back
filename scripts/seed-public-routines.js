// Siembra las rutinas públicas: rutinas sin dueño (Table sin `userId`) que
// todos los clientes ven en «Rutinas» y que los profesionales pueden asignar
// como plantilla (table-service.js#assignTemplateToClient). Están en
// scripts/data/public-routines/ y sus ejercicios apuntan, por su `_id`, al
// catálogo de producción (exercises.js).
//
// Se lanza con el resto del contenido de fábrica: `npm run presets`
// (scripts/presets.js).
//
// Requisito: la base ya está en el modelo de datos de 2026-10 (microciclos
// dentro de la rutina, ejercicios y series dentro de cada sesión; npm run
// migrate). Si encuentra una rutina o una sesión con el formato
// viejo, no escribe nada.
//
// Cada rutina es un bloque de 4 semanas (data/public-routines/mesocycle.js):
// un microciclo por semana con las mismas sesiones en cada fila y la pauta de
// esa semana (prescribeSets). Los bloques de una sesión (superseries,
// circuitos…) tienen el mismo `_id` en toda su fila, como los que crea la app.
//
// Idempotente: una rutina pública con el mismo nombre ya existe y no se toca.
// Si un ejercicio no está en el catálogo (no existe, es de un usuario o está
// retirado), las rutinas que lo usan no se crean y el informe lo dice; las
// demás sí.

const mongoose = require("mongoose");
const Exercise = require("../components/exercises/exercise-schema");
const Table = require("../components/tables/table-schema");
const Workout = require("../components/workouts/workout-schema");
const WorkoutBase = require("../components/workouts/workout-base-schema");
const tableDao = require("../components/tables/table-dao");
const { compactSet } = require("../components/sets/set-schema");
const { EXERCISES, ROUTINES, WEEKS, DELOAD_RIR } = require("./data/public-routines");


const FAILURE = -1;

const newObjectId = () => new mongoose.Types.ObjectId();

// RIR pautado de un ejercicio en una semana. Los básicos nunca se pautan por
// debajo de 1 y los de aislamiento de 0; la descarga se aleja del fallo.
function rirForWeek(item, week) {
  if (item.rir == null) return null;
  if (week.deload) return Math.max(item.rir, DELOAD_RIR);
  const floor = item.isolation ? 0 : 1;
  return Math.max(floor, item.rir + (week.rirDelta || 0));
}

// Las series de un ejercicio en una semana, con lo prescrito y nada de
// ejecución. Dentro de un bloque, una serie por ronda en todas las semanas
// (el bloque es de la fila: sus rondas no cambian de un microciclo a otro) y
// el descanso lo marca el bloque: entre ejercicios, o entre rondas tras el
// último.
function prescribeSets(item, week, { block = null, isLastInBlock = false, newId = newObjectId } = {}) {
  const count = block ? block.rounds : week.deload ? Math.ceil(item.sets / 2) : item.sets;
  const rest = block ? (isLastInBlock ? block.restBetweenRounds : block.restBetweenExercises) : item.rest;
  const rir = rirForWeek(item, week);
  return Array.from({ length: count }, (_, index) => {
    const isLast = index === count - 1;
    const toFailure = isLast && item.isolation && rir != null && week.failLastIsolationSet;
    return compactSet({
      _id: newId(),
      order: index,
      expectedTime: item.time,
      expectedReps: item.time ? undefined : item.reps,
      expectedRir: item.time || rir == null ? undefined : [toFailure ? FAILURE : rir],
      restSeconds: rest ?? undefined,
    });
  });
}

// Bloques de una sesión con su `_id` (uno por fila, el mismo en todos los
// microciclos) y sin la clave de los datos.
function rowBlocks(workout, newId) {
  return (workout.blocks || []).map(({ key, ...block }, order) => ({ ...block, key, order, _id: newId() }));
}

// La rutina tal como la guardaría la app: la Table sin dueño con un
// microciclo por semana y las sesiones (Workout) de todos los microciclos.
function buildRoutineDocuments(routine, { exercises = EXERCISES, weeks = WEEKS, newId = newObjectId } = {}) {
  const rows = routine.workouts.map((workout) => ({ workout, blocks: rowBlocks(workout, newId) }));
  const workouts = [];
  const splits = weeks.map((week) => {
    const ids = rows.map(({ workout, blocks }) => {
      const blockByKey = new Map(blocks.map((block) => [block.key, block]));
      const doc = {
        _id: newId(),
        name: workout.name,
        notes: workout.notes,
        isPlannedRestDay: false,
        blocks: blocks.map(({ key, ...block }) => block),
        exercises: workout.exercises.map((item, order) => {
          const block = item.block ? blockByKey.get(item.block) : null;
          const blockItems = block ? workout.exercises.filter((other) => other.block === item.block) : [];
          return {
            _id: newId(),
            exercise: new mongoose.Types.ObjectId(exercises[item.ex].exercise),
            order,
            notes: item.notes,
            blockId: block ? block._id : null,
            sets: prescribeSets(item, week, { block, isLastInBlock: blockItems.at(-1) === item, newId }),
          };
        }),
      };
      workouts.push(doc);
      return doc._id;
    });
    return { _id: newId(), name: week.name, objective: week.objective, purpose: week.purpose, workouts: ids };
  });
  return { table: { name: routine.name, splits, pinnedNotes: [] }, workouts };
}

// Qué claves de exercises.js se pueden usar: el ejercicio existe, es del
// catálogo global (sin dueño) y no está retirado.
function checkExercises(catalog, found) {
  const byId = new Map(found.map((exercise) => [String(exercise._id), exercise]));
  const available = new Set();
  const missing = [];
  const owned = [];
  const retired = [];
  for (const [key, entry] of Object.entries(catalog)) {
    const exercise = byId.get(entry.exercise);
    if (!exercise) missing.push(key);
    else if (exercise.userId) owned.push(key);
    else if (exercise.deletedAt) retired.push(key);
    else available.add(key);
  }
  return { available, missing, owned, retired };
}

function planSeed({ routines, availableKeys, existingNames }) {
  const toCreate = [];
  const existing = [];
  const blocked = [];
  for (const routine of routines) {
    if (existingNames.has(routine.name)) {
      existing.push(routine);
      continue;
    }
    const keys = [...new Set(routine.workouts.flatMap((workout) => workout.exercises.map((item) => item.ex)))];
    const missingKeys = keys.filter((key) => !availableKeys.has(key));
    if (missingKeys.length) blocked.push({ routine, missingKeys });
    else toCreate.push(routine);
  }
  return { toCreate, existing, blocked };
}

// Resumen para el informe: sesiones por semana y series de la semana 1.
function describeRoutine(routine, weeks = WEEKS) {
  const weeklySets = routine.workouts.reduce(
    (total, workout) =>
      total +
      workout.exercises.reduce((sum, item) => {
        const block = (workout.blocks || []).find((candidate) => candidate.key === item.block);
        return sum + (block ? block.rounds : item.sets);
      }, 0),
    0,
  );
  return `${weeks.length} semanas × ${routine.workouts.length} sesiones, ${weeklySets} series en la semana 1`;
}

async function assertNewDataModel() {
  const legacyTable = await Table.collection.findOne({ "splits.0": { $type: "objectId" } }, { projection: { name: 1 } });
  const legacyWorkout = await WorkoutBase.collection.findOne({ "exercises.0": { $type: "objectId" } }, { projection: { name: 1 } });
  const legacy = legacyTable || legacyWorkout;
  if (legacy) {
    const what = legacyTable ? "La rutina" : "La sesión";
    throw new Error(
      `${what} "${legacy.name}" (${legacy._id}) aún tiene el formato viejo. Aplica antes npm run migrate.`,
    );
  }
}

// Inserta las sesiones y después la rutina; si la rutina falla, fuera las
// sesiones para no dejar huérfanas.
async function insertRoutine({ table, workouts }) {
  await Workout.insertMany(workouts);
  try {
    return await tableDao.createTable(table);
  } catch (error) {
    await Workout.deleteMany({ _id: { $in: workouts.map((workout) => workout._id) } });
    throw error;
  }
}

async function seedPublicRoutines({ routines = ROUTINES, exercises = EXERCISES, weeks = WEEKS, dryRun = false, log = () => {} } = {}) {
  await assertNewDataModel();

  const exerciseIds = Object.values(exercises).map((entry) => new mongoose.Types.ObjectId(entry.exercise));
  const found = await Exercise.find({ _id: { $in: exerciseIds } }).select("name userId deletedAt").lean();
  const { available, missing, owned, retired } = checkExercises(exercises, found);
  for (const key of missing) log(`AVISO: falta el ejercicio "${key}": ${exercises[key].name} (${exercises[key].exercise})`);
  for (const key of owned) log(`AVISO: el ejercicio "${key}" (${exercises[key].exercise}) es de un usuario, no del catálogo`);
  for (const key of retired) log(`AVISO: el ejercicio "${key}" (${exercises[key].exercise}) está retirado`);

  const existingNames = new Set(
    await Table.find({ userId: { $exists: false }, name: { $in: routines.map((routine) => routine.name) } }).distinct("name"),
  );
  const { toCreate, existing, blocked } = planSeed({ routines, availableKeys: available, existingNames });
  for (const routine of existing) log(`ya existe "${routine.name}"`);
  for (const { routine, missingKeys } of blocked) log(`no se crea "${routine.name}": faltan ${missingKeys.join(", ")}`);

  for (const routine of toCreate) {
    log(`${dryRun ? "se crearía" : "crea"} "${routine.name}": ${describeRoutine(routine, weeks)}`);
    if (!dryRun) await insertRoutine(buildRoutineDocuments(routine, { exercises, weeks }));
  }

  const stats = {
    routines: routines.length,
    created: dryRun ? 0 : toCreate.length,
    toCreate: toCreate.length,
    existing: existing.length,
    blocked: blocked.length,
    missingExercises: missing.length + owned.length + retired.length,
  };
  log(JSON.stringify(stats));
  return stats;
}

module.exports = {
  FAILURE,
  buildRoutineDocuments,
  checkExercises,
  describeRoutine,
  planSeed,
  prescribeSets,
  rirForWeek,
  seedPublicRoutines,
};
