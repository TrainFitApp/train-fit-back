const {
  loadTrainerContext,
  buildClientSnapshots,
  ensureEvaluatedToday,
} = require("../coachAlerts/coach-alert-service");
const { SIGNAL_THRESHOLDS } = require("../coachAlerts/coach-signals-service");
const { computeAdherence } = require("./adherence-service");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { taskLabel } = require("../trainerTasks/task-label");
const tableDao = require("../tables/table-dao");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const { computeWindowedTrainingProgress, pickCurrentPhase } = require("../routineAssignments/routine-assignment-schedule");
const CoachAlert = require("../coachAlerts/coach-alert-schema");
const clientIntakeDao = require("../clientIntake/client-intake-dao");
const { intakeStatusFor } = require("../trainerClients/intake-pending");

/**
 * Movimiento 1 Coach Pro — la CARTERA: una fila por cliente, ordenable, con
 * las cinco cosas que un entrenador mira para decidir a quién atiende hoy.
 *
 * El problema que resuelve: hasta ahora la única forma de comparar clientes
 * entre sí era abrir sus fichas de una en una y acordarse. El panel Hoy
 * enseña lo urgente, pero lo urgente no es lo mismo que el estado general —
 * un cliente al 45% de adherencia que todavía no ha disparado ninguna alerta
 * es invisible en Hoy y evidente aquí.
 *
 * NADA de lo que se calcula aquí es nuevo:
 *   - loadTrainerContext + buildClientSnapshots son literalmente los de la
 *     evaluación de alertas. Reusarlos garantiza que el "62%" de la Cartera
 *     es el mismo número que disparó la alerta, no otro parecido.
 *   - computeAdherence es el mismo cálculo puro que la pestaña Resumen de la
 *     ficha, con la misma ventana de 28 días.
 *
 * Coste: el de loadTrainerContext (11 consultas fijas, ninguna por cliente)
 * más 4 agrupadas. Si hoy aún no se habían evaluado las alertas, se evalúan
 * con ESE mismo contexto: los recuentos de alertas salen al día sin volver a
 * leer nada de los clientes.
 */

// Misma ventana que el resumen de la ficha y que el evaluador de alertas.
// Tres números distintos para "la adherencia de este cliente" según qué
// pantalla mires sería peor que no tener ninguno.
const ROSTER_WINDOW_DAYS = SIGNAL_THRESHOLDS.analysisWindowDays;

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(isoDay, days) {
  const date = new Date(`${isoDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Variación de peso dentro de la ventana: primera medición contra la última.
 *
 * No reutiliza buildWeightTrend (progress-service) a propósito: aquélla
 * trabaja sobre series semanales ya agregadas, que en la Cartera no hacen
 * falta y costarían montarlas para 30 clientes. Aquí las mediciones bastan
 * porque la pregunta es más simple — "¿sube o baja?", no "¿cómo de rápido?".
 *
 * `entries` llega en orden ASC (anthropometryDao.listForUsersSince).
 */
function weightChangeFor(entries) {
  const withWeight = (entries || []).filter(
    (entry) => typeof entry.weight === "number" && Number.isFinite(entry.weight)
  );
  if (withWeight.length < 2) return null;

  const first = withWeight[0];
  const last = withWeight[withWeight.length - 1];
  const absolute = round(last.weight - first.weight, 2);

  return {
    absolute,
    percentage: first.weight ? round((absolute / first.weight) * 100, 2) : null,
    from: { date: first.date, weight: first.weight },
    to: { date: last.date, weight: last.weight },
    measurements: withWeight.length,
  };
}

function daysSince(date, now) {
  if (!date) return null;
  return Math.floor((now.getTime() - new Date(date).getTime()) / 86400000);
}

/**
 * Alertas abiertas por cliente, en una sola agregación.
 *
 * Aparte del DAO de alertas porque es una consulta de RECUENTO para la
 * cartera entera; listForClient devuelve documentos completos de un cliente y
 * traerlos todos para contarlos sería mover kilobytes para producir enteros.
 */
async function countOpenAlertsByClient(trainerId) {
  const mongoose = require("mongoose");
  const rows = await CoachAlert.aggregate([
    {
      $match: {
        trainerId: new mongoose.Types.ObjectId(String(trainerId)),
        status: "open",
      },
    },
    {
      $group: {
        _id: "$clientId",
        total: { $sum: 1 },
        // La prioridad se guarda como string; aquí solo hace falta saber si
        // hay alguna urgente, así que se cuenta directamente en Mongo.
        high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), { total: row.total, high: row.high }]));
}

// Días que un hábito lleva activo dentro de la ventana. Mismo criterio que
// client-progress-controller#diasActivos.
function diasActivosDeTarea(task, periodDays, now) {
  const desdeCreacion = Math.floor((now.getTime() - new Date(task.createdAt).getTime()) / 86400000) + 1;
  return Math.max(0, Math.min(periodDays, desdeCreacion));
}

// Tarea 5bis (2026-09) — igual que client-data-loader.js#loadTrainingWindow:
// adherencia de entrenamiento de la fase EN CURSO, no de la ventana fija de
// la Cartera. `phases` ya está cargado para TODOS los clientes de golpe
// (listByClients, ver buildRoster) — pickCurrentPhase filtra en memoria, sin
// consulta extra por cliente.
function computeCurrentPhaseTraining(phases, splitsByTableId, today) {
  const currentPhase = pickCurrentPhase(phases, today);
  if (!currentPhase) return { plannedTotal: 0, completedSessions: 0, scheduledDays: 0 };

  return computeWindowedTrainingProgress(
    [currentPhase],
    splitsByTableId,
    currentPhase.startDate,
    today
  );
}

async function buildRoster(trainerId, now = new Date()) {
  const to = isoDate(now);
  const from = addDays(to, -(ROSTER_WINDOW_DAYS - 1));

  const context = await loadTrainerContext(trainerId, now);
  const snapshots = buildClientSnapshots(context, now);

  // Solo los clientes con relación activa: los que están "en_revision"
  // todavía no tienen nada que medir, y su sitio es el aviso de alta del
  // panel Hoy, no una fila de adherencia vacía aquí.
  const activeSnapshots = snapshots.filter((snapshot) => snapshot.relationStatus === "active");
  const clientIds = activeSnapshots.map((snapshot) => snapshot.clientId);

  // Tarea 5bis (2026-09) — entrenamiento de la fase EN CURSO de cada
  // cliente, no de su historial completo (ver computeCurrentPhaseTraining).
  // context.tableIdByClient (el tableInUse de loadTrainerContext) tampoco
  // sirve como atajo: puede quedarse desfasado para fases futuras — ver
  // client-data-loader.js#loadTrainingWindow, mismo criterio. Un único
  // listByClients y un único getSplitsForTables para toda la cartera, no
  // una consulta por cliente — pero SOLO de las tablas de la fase actual de
  // cada uno, no de todo el historial (ya no hace falta el resto).
  const [activeTasks, phasesByClient, alertsByClient, intakes] = await Promise.all([
    trainerTaskDao.listForClients(trainerId, clientIds),
    routineAssignmentDao.listByClients(clientIds),
    ensureEvaluatedToday(trainerId, { now, context }).then(() => countOpenAlertsByClient(trainerId)),
    clientIntakeDao.listStateByTrainer(trainerId, clientIds),
  ]);
  const intakeByClient = new Map(intakes.map((intake) => [String(intake.clientId), intake]));
  // Scopes de cada cliente: "Rechazar" desde la Cartera termina todas sus
  // relaciones (una por scope) sin pasar por la ficha.
  const scopesByClient = new Map(
    context.activeClients.filter((entry) => entry.user).map((entry) => [String(entry.user._id), entry.scopes])
  );

  const currentTableIds = [
    ...new Set(
      [...phasesByClient.values()]
        .map((phases) => pickCurrentPhase(phases, to)?.tableId)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const splitsByTableId = currentTableIds.length
    ? await tableDao.getSplitsForTables(currentTableIds)
    : new Map();

  const taskIds = activeTasks.map((task) => task._id);
  const completions = await trainerTaskDao.listCompletionsForTasksInRange(taskIds, from, to);

  // Marcas por TAREA, no por cliente: cada hábito se mide contra sus propios
  // días activos, así que ya no vale un total por cliente.
  // Mismo criterio que la ficha: una marca anterior a la creación del
  // hábito no cuenta (ver client-progress-controller#buildAdherenceInput).
  const creacionPorTarea = new Map(
    activeTasks.map((task) => [String(task._id), isoDate(task.createdAt)])
  );
  const marcasPorTarea = new Map();
  for (const completion of completions) {
    const key = String(completion.taskId);
    const desde = creacionPorTarea.get(key);
    if (desde && completion.date < desde) continue;
    marcasPorTarea.set(key, (marcasPorTarea.get(key) || 0) + 1);
  }
  const tareasPorCliente = new Map();
  for (const task of activeTasks) {
    const key = String(task.clientId);
    tareasPorCliente.set(key, [...(tareasPorCliente.get(key) || []), task]);
  }

  return activeSnapshots.map((snapshot) => {
    const clientKey = String(snapshot.clientId);

    const adherence = computeAdherence({
      // El snapshot ya trae la adherencia nutricional calculada por
      // loadTrainerContext con computeRangeAdherence — la misma función que
      // usa la ficha del cliente.
      nutrition: snapshot.adherence,
      training: computeCurrentPhaseTraining(
        phasesByClient.get(clientKey) || [],
        splitsByTableId,
        to
      ),
      habits: {
        habits: (tareasPorCliente.get(clientKey) || []).map((task) => ({
          id: String(task._id),
          label: taskLabel(task),
          target: task.target,
          unit: task.unit,
          completions: marcasPorTarea.get(String(task._id)) || 0,
          activeDays: diasActivosDeTarea(task, ROSTER_WINDOW_DAYS, now),
        })),
      },
      checkins: snapshot.checkin
        ? { expected: snapshot.checkin.expected || 0, answered: snapshot.checkin.answered || 0 }
        : { expected: 0, answered: 0 },
    });

    const alerts = alertsByClient.get(clientKey) || { total: 0, high: 0 };

    return {
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
      clientEmail: snapshot.clientEmail || "",
      // Cuestionario inicial: sin enviar / por revisar / revisado (null =
      // relación antigua sin cuestionario). Ver intake-pending.js.
      scopes: scopesByClient.get(clientKey) || [],
      intakeStatus: intakeStatusFor({
        intakePending: snapshot.intakePending,
        intake: intakeByClient.get(clientKey),
      }),
      adherence: {
        overall: adherence.overall,
        weakest: adherence.weakest,
        // El desglose entero, no solo la media: la Cartera enseña la media y
        // el punto débil, pero la fila desplegada necesita los cuatro
        // números y sus motivos de "no aplica" sin una segunda petición.
        dimensions: adherence.dimensions,
      },
      weightChange: weightChangeFor(snapshot.entries),
      lastCheckinAt: snapshot.lastResponseAt || null,
      daysSinceCheckin: daysSince(snapshot.lastResponseAt, now),
      nextCheckinDate: snapshot.checkin?.nextDate || null,
      lastActivityAt: snapshot.lastActivityAt || null,
      daysSinceActivity: daysSince(snapshot.lastActivityAt, now),
      sessions: (snapshot.workoutDates || []).length,
      openAlerts: alerts.total,
      urgentAlerts: alerts.high,
    };
  });
}

module.exports = {
  ROSTER_WINDOW_DAYS,
  buildRoster,
  // Exportadas para test unitario — son las dos piezas con criterio propio.
  weightChangeFor,
  daysSince,
};
