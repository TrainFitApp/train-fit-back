const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const checkinDao = require("../trainerCheckins/checkin-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const tableDao = require("../tables/table-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { isoDate } = require("./progress-service");

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
    planProgress,
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
    // Progreso del plan entero (sesiones hechas / sesiones que tiene la
    // rutina), no una extrapolación del último microciclo por semanas.
    client.tableInUse
      ? tableDao.getPlanSessionProgressForTables([client.tableInUse])
      : new Map(),
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
    planProgress: planProgress.get(String(client.tableInUse)) || { plannedTotal: 0, completedTotal: 0 },
    activeTasks,
    taskCompletions,
  };
}

module.exports = { loadClientWindow };
