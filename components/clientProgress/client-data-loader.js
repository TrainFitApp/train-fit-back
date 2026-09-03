const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const checkinDao = require("../trainerCheckins/checkin-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const tableDao = require("../tables/table-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const { sortPhasesAscending, computeWindowedTrainingProgress } = require("../routineAssignments/routine-assignment-schedule");
const { isoDate } = require("./progress-service");
const { todayIsoDate } = require("../util/date-util");

// Tarea 5 (2026-09) — progreso de entrenamiento por VENTANA + FASE: la
// fuente de verdad es el historial de RoutineAssignment, nunca
// `client.tableInUse` (puede quedarse desfasado para fases futuras hasta
// que se abre la pestaña de Tablas — ver routine-assignment-service.js#
// syncTableInUseIfDue, que aquí no se llama). Sin ninguna fase que cubra la
// ventana, plannedTotal sale 0 de forma natural y trainingDimension ya lo
// resuelve (`applicable:false, reason:"sin_plan"`) sin cambios.
async function loadTrainingWindow(clientId, from, to) {
  const phases = sortPhasesAscending(await routineAssignmentDao.listByClient(clientId));
  const tableIds = [...new Set(phases.map((phase) => String(phase.tableId)))];
  const splitsByTableId = tableIds.length ? await tableDao.getSplitsForTables(tableIds) : new Map();
  const periodEndClamped = to < todayIsoDate() ? to : todayIsoDate();
  return computeWindowedTrainingProgress(phases, splitsByTableId, from, periodEndClamped);
}

// Fase 2 Coach Pro — todo lo que hace falta de UN cliente para calcular su
// adherencia y su progreso, cargado una sola vez.
//
// Separado de los servicios de cálculo (adherence-service, progress-service),
// que son puros y no tocan la BD, y del controller, que solo maneja HTTP.
// Los dos endpoints de este componente necesitan exactamente lo mismo, así
// que duplicar la carga en cada uno habría sido la vía rápida a que se
// desincronizaran.
//
// A diferencia del evaluador nocturno de alertas (coach-alert-service.js),
// aquí SÍ vale gastar ~9 consultas: es un cliente concreto, bajo demanda,
// con su ficha abierta delante. Lo que allí era un fan-out sobre 30 clientes,
// aquí es el coste normal de una pantalla de detalle.

async function loadClientWindow(trainerId, clientId, { from, to }) {
  const client = await userSchema
    .findById(clientId)
    .select("name lastname dietInUse goalInUse tableInUse")
    .lean();

  if (!client) return null;

  const [
    anthropometryDesc,
    allCheckinResponses,
    checkinConfig,
    dietDays,
    workoutDates,
    trainingWindow,
    activeTasks,
  ] = await Promise.all([
    anthropometryDao.getAnthropometriesByUserIdBetweenDates(clientId, from, to),
    checkinDao.listResponses(trainerId, clientId),
    checkinDao.getAppliedConfig(trainerId, clientId),
    client.dietInUse
      ? dietDaysDao.getFullyPopulatedDietDaysForDiet(client.dietInUse, from, to)
      : [],
    tableDao.listCompletedWorkoutDates(
      clientId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`)
    ),
    // Progreso de la ventana pedida, por fase (RoutineAssignment) — no de
    // toda la vida de la tabla. Ver loadTrainingWindow arriba.
    loadTrainingWindow(clientId, from, to),
    trainerTaskDao.listForClient(trainerId, clientId),
  ]);

  const taskCompletions = await trainerTaskDao.listCompletionsForTasksInRange(
    activeTasks.map((t) => t._id),
    from,
    to
  );

  return {
    client,
    // getAnthropometriesByUserIdBetweenDates ordena DESC (es lo que quieren
    // sus otros consumidores, que pintan "lo último primero"). El cálculo de
    // series y tendencias recorre la historia hacia delante, así que aquí se
    // invierte una vez en vez de que cada consumidor se acuerde de hacerlo.
    anthropometryEntries: [...anthropometryDesc].reverse(),
    // listResponses no filtra por fecha (el histórico completo alimenta la
    // pestaña de check-ins). Para la ventana se recorta aquí.
    checkinResponses: allCheckinResponses
      .filter((r) => isoDate(r.respondedAt) >= from && isoDate(r.respondedAt) <= to)
      .reverse(),
    allCheckinResponses,
    checkinConfig,
    dietDays,
    workoutDates,
    planProgress: { plannedTotal: trainingWindow.plannedTotal, completedTotal: trainingWindow.completedSessions },
    activeTasks,
    taskCompletions,
  };
}

module.exports = { loadClientWindow };
