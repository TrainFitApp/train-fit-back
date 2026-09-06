const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const checkinDao = require("../trainerCheckins/checkin-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const tableDao = require("../tables/table-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const { computeWindowedTrainingProgress } = require("../routineAssignments/routine-assignment-schedule");
const { isoDate } = require("./progress-service");
const { todayIsoDate } = require("../util/date-util");

// Tarea 5bis (2026-09) — progreso de entrenamiento de la FASE EN CURSO, no
// de una ventana de días arbitraria. Antes se recorría TODO el historial de
// RoutineAssignment del cliente (fases pasadas incluidas) para repartir
// plannedTotal/completedSessions por tramos dentro de la ventana. Se
// simplifica a propósito: "¿sigue mi cliente el programa que le di AHORA?"
// es la pregunta real (decisión del usuario), no un cociente que mezcla
// programas ya sustituidos. Efecto colateral deseado: ya no depende de que
// las fases pasadas sigan existiendo — borrar una fase antigua (ver
// routine-assignment-service.js#cancelPhase, generalizada para admitir
// cualquier fase) no puede desviar en silencio ningún número de adherencia,
// porque la adherencia nunca mira fases pasadas.
//
// `client.tableInUse` no sirve como atajo (puede quedarse desfasado para
// fases futuras hasta que se abre la pestaña de Tablas — ver
// routine-assignment-service.js#syncTableInUseIfDue, que aquí no se llama);
// `findCoveringDate` ya resuelve "qué fase rige HOY" por fecha, igual que ya
// hace el frontend (client-detail.page.ts#currentRoutinePhase). Sin ninguna
// fase que cubra hoy, plannedTotal sale 0 de forma natural y
// trainingDimension ya lo resuelve (`applicable:false, reason:"sin_plan"`)
// sin cambios.
async function loadTrainingWindow(clientId, to) {
  const periodEndClamped = to < todayIsoDate() ? to : todayIsoDate();
  const currentPhase = await routineAssignmentDao.findCoveringDate(clientId, periodEndClamped);
  if (!currentPhase) return { plannedTotal: 0, completedSessions: 0 };

  const splitsByTableId = await tableDao.getSplitsForTables([String(currentPhase.tableId)]);
  return computeWindowedTrainingProgress(
    [currentPhase],
    splitsByTableId,
    currentPhase.startDate,
    periodEndClamped
  );
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
    .select("name lastname goalInUse tableInUse")
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
    client._id
      ? dietDaysDao.getFullyPopulatedDietDaysForUser(client._id, from, to)
      : [],
    tableDao.listCompletedWorkoutDates(
      clientId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`)
    ),
    // Progreso de la fase EN CURSO, no de la ventana pedida. Ver
    // loadTrainingWindow arriba.
    loadTrainingWindow(clientId, to),
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
