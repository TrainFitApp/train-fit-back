const Table = require("./table-schema");
const Split = require("../splits/split-schema");
const Workout = require("../workouts/workout-schema");
const CustomExercise = require("../customExercises/custom-exercise-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

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
    const relation = await trainerClientDao.findActiveByTrainerAndClient(
      req.user.id,
      ownerUserId,
      "training",
    );
    return Boolean(relation);
  }
  return false;
}

async function findTableOwningSplit(splitId) {
  if (!splitId) return null;
  return Table.findOne({ splits: splitId }).select("_id userId assignedByTrainerId");
}

async function findTableOwningWorkout(workoutId) {
  if (!workoutId) return null;
  const split = await Split.findOne({ workouts: workoutId }).select("_id");
  if (!split) return null;
  return findTableOwningSplit(split._id);
}

async function findTableOwningCustomExercise(customExerciseId) {
  if (!customExerciseId) return null;
  const workout = await Workout.findOne({ exercises: customExerciseId }).select("_id");
  if (!workout) return null;
  return findTableOwningWorkout(workout._id);
}

async function findTableOwningSet(setId) {
  if (!setId) return null;
  const customExercise = await CustomExercise.findOne({ sets: setId }).select("_id");
  if (!customExercise) return null;
  return findTableOwningCustomExercise(customExercise._id);
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
  findTableOwningSplit,
  findTableOwningWorkout,
  findTableOwningCustomExercise,
  findTableOwningSet,
  rejectIfAssignedTableLockedForOwner,
};
