const Table = require("./table-schema");
const Workout = require("../workouts/workout-schema");
const { isObjectId } = require("../workouts/workout-tree");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { isReadOnly, READ_METHODS } = require("../trainerClients/trainer-seat-service");

// Replanteamiento MVP (rutinas) — hasta ahora split-controller.js era el
// ÚNICO de los 4 controllers de la cadena Table>Split>Workout>CustomExercise>Set
// que comprobaba propiedad, y solo para el propio usuario (nunca para un
// profesional). Este módulo centraliza esa comprobación (dueño real, admin, o
// profesional con relación "training" ACTIVA con el dueño de la tabla) y la
// resolución hacia atrás desde cualquier nivel de la cadena hasta su Table,
// necesaria porque split/workout/customExercise/set no guardan una referencia
// directa a su tabla — solo Table conoce sus splits.

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function isTrainer(req) {
  return Boolean(req.userData?.roles?.includes("trainer"));
}

// ¿Puede este request leer/mutar una tabla propiedad de `ownerUserId`? Dueño
// real, admin, o profesional con relación "training" activa con ese cliente
// (mismo criterio que ya usa isMicrocycleExempt para las exenciones F14).
async function canAccessUserTable(req, ownerUserId) {
  if (!ownerUserId) return false;
  if (isAdmin(req)) return true;
  if (String(req.user?.id) === String(ownerUserId)) return true;
  if (isTrainer(req)) {
    if (!(await trainerClientDao.isActivePair(req.user.id, ownerUserId, "training"))) return false;
    // Cliente fuera de las plazas activas del plan: solo lectura en el Planner.
    if (!READ_METHODS.has(req.method) && await isReadOnly(req.user.id, ownerUserId)) return false;
    return true;
  }
  return false;
}

const TABLE_ACCESS_FIELDS = "_id userId assignedByTrainerId";

// La tabla con lo que hace falta para decidir el acceso (y sus microciclos,
// si se piden). null si el id no vale o no existe.
async function findTableForAccess(tableId, { withSplits = false } = {}) {
  if (!isObjectId(tableId)) return null;
  return Table.findById(tableId)
    .select(withSplits ? `${TABLE_ACCESS_FIELDS} splits._id` : TABLE_ACCESS_FIELDS)
    .lean();
}

// MVP-trainers D10/F14: hasta 21 microciclos (no 4) SOLO si la rutina fue
// asignada por un profesional Y su dueño tiene AHORA relación "training"
// activa: revierte al terminar la relación. Se mira la relación del DUEÑO de
// la tabla, no la de quien hace la petición (puede ser su profesional).
async function isMicrocycleExempt(table) {
  if (!table?.assignedByTrainerId) return false;
  return trainerClientDao.hasActiveTrainer(table.userId, "training");
}

async function findTableOwningSplit(splitId) {
  if (!isObjectId(splitId)) return null;
  return Table.findOne({ "splits._id": splitId }).select(TABLE_ACCESS_FIELDS).lean();
}

async function findTableOwningWorkout(workoutId) {
  if (!isObjectId(workoutId)) return null;
  return Table.findOne({ "splits.workouts": workoutId }).select(TABLE_ACCESS_FIELDS).lean();
}

async function findTableOwningCustomExercise(customExerciseId) {
  if (!isObjectId(customExerciseId)) return null;
  const workout = await Workout.findOne({ "exercises._id": customExerciseId }).select("_id").lean();
  if (!workout) return null;
  return findTableOwningWorkout(workout._id);
}

async function findTableOwningSet(setId) {
  if (!isObjectId(setId)) return null;
  const workout = await Workout.findOne({ "exercises.sets._id": setId }).select("_id").lean();
  if (!workout) return null;
  return findTableOwningWorkout(workout._id);
}

// 2026-09 — hueco real: canAccessUserTable deja mutar al DUEÑO de la tabla
// sin mirar assignedByTrainerId, así que un cliente podía editar/borrar por
// completo una rutina que le asignó su entrenador (renombrar, añadir/quitar
// microciclos, entrenamientos, ejercicios, series). Mismo problema que ya
// resuelve meal-service.js#assertMealEditable para Nutrición — aquí como
// boolean que envía la respuesta, para encajar con el estilo de los
// chokepoints locales de cada controller (assertCanAccessTableId y
// compañía), no con el estilo de excepción de Meals.
//
// Solo bloquea MUTACIONES (los controllers deciden cuándo llamar a esto,
// nunca en las lecturas) y solo cuando quien escribe es el propio DUEÑO
// (cliente) de la tabla — nunca al entrenador que la asignó, que sigue
// editándola desde su Planificador por estas mismas rutas genéricas (a
// diferencia de Meals, aquí no hay una ruta trainer-only separada).
function rejectIfAssignedTableLockedForOwner(req, res, table) {
  if (!table?.assignedByTrainerId) return false;
  if (isAdmin(req)) return false;
  if (String(req.user?.id) !== String(table.userId)) return false;
  res.status(403).send({
    message: "Esta rutina te la asignó tu entrenador. Pídele el cambio en vez de editarla tú mismo.",
    code: "TABLE_ASSIGNED_BY_TRAINER",
  });
  return true;
}

module.exports = {
  isAdmin,
  isTrainer,
  canAccessUserTable,
  findTableForAccess,
  isMicrocycleExempt,
  findTableOwningSplit,
  findTableOwningWorkout,
  findTableOwningCustomExercise,
  findTableOwningSet,
  rejectIfAssignedTableLockedForOwner,
};
