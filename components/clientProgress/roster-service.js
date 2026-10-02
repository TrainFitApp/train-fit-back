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
const checkinDao = require("../trainerCheckins/checkin-dao");
const formCheckDao = require("../formChecks/form-check-dao");

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
  // Scopes de cada cliente: "Rechazar" desde la Cartera termina todas sus
  // relaciones (una por scope) sin pasar por la ficha.
  const scopesByClient = new Map(
    context.activeClients.filter((entry) => entry.user).map((entry) => [String(entry.user._id), entry.scopes])
  );
  // Revisiones de técnica: solo de clientes de entrenamiento (el
  // nutricionista no las ve, form-check-service.js#activeTrainingClientIds).
  const trainingClientIds = clientIds.filter((id) => (scopesByClient.get(String(id)) || []).includes("training"));

  const [activeTasks, phasesByClient, alertsByClient, intakes, pendingCheckins, pendingFormChecks] = await Promise.all([
    trainerTaskDao.listForClients(trainerId, clientIds),
    routineAssignmentDao.listByClients(clientIds),
    ensureEvaluatedToday(trainerId, { now, context }).then(() => countOpenAlertsByClient(trainerId)),
    clientIntakeDao.listStateByTrainer(trainerId, clientIds),
    // Columna «Por revisar»: lo que el cliente ha mandado y espera respuesta.
    clientIds.length ? checkinDao.countPendingReviewByClient(trainerId, clientIds) : new Map(),
    trainingClientIds.length ? formCheckDao.countPendingByClient(trainerId, trainingClientIds) : new Map(),
  ]);
  const intakeByClient = new Map(intakes.map((intake) => [String(intake.clientId), intake]));

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
      pendingCheckins: pendingCheckins.get(clientKey) || 0,
      pendingFormChecks: pendingFormChecks.get(clientKey) || 0,
    };
  });
}

// --- Paginación de la Cartera ---
//
// La tabla ya no recibe la cartera entera: el front pide una página con su
// búsqueda, filtros y orden, y el servidor devuelve solo esas filas. Lo que
// NO cambia es el cálculo: ordenar por adherencia, peso o alertas exige
// tener las cifras de todos los clientes, y esas cifras salen del mismo
// loadTrainerContext que evalúa las alertas (que se calcula entero igual).
// Paginar ahorra la respuesta y el pintado, no la agregación.

const ROSTER_DEFAULT_LIMIT = 25;
const ROSTER_MAX_LIMIT = 100;
const ROSTER_SEARCH_MAX_LENGTH = 100;
const ROSTER_SORT_KEYS = ["name", "adherence", "weight", "checkin", "sessions", "review", "alerts"];
const ROSTER_DIMENSIONS = ["nutrition", "training", "habits", "checkins"];

// Días sin check-in a partir de los que el filtro lo da por vencido. Mismo
// umbral que usaba la tabla cuando filtraba en el navegador.
const OVERDUE_CHECKIN_DAYS = 7;

const nameCollator = new Intl.Collator("es", { sensitivity: "base" });

function parseFlag(value) {
  return value === "1" || value === "true";
}

function parseIntInRange(value, fallback, min, max) {
  const parsed = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// Al cambiar de columna se arranca por el extremo que interesa mirar: la
// peor adherencia, el que lleva más sin reportar, el que más alertas tiene.
function defaultDescending(sort) {
  return sort !== "name" && sort !== "adherence";
}

/**
 * Query string de GET /trainer/roster a opciones ya saneadas. Permisiva a
 * propósito, como /trainer/clients/paginated: un valor desconocido vuelve a
 * su valor por defecto en vez de dar 400, porque lo único que puede pasar
 * es que la tabla salga en el orden de siempre.
 *
 *   page     0-based
 *   limit    1..100 (25 por defecto)
 *   search   nombre o correo
 *   sort     name | adherence | weight | checkin | sessions | review | alerts
 *   dir      asc | desc
 *   weakest  nutrition | training | habits | checkins
 *   alerts, overdue, pending   "1" para activar el filtro
 */
function parseRosterQuery(query = {}) {
  const sort = ROSTER_SORT_KEYS.includes(query.sort) ? query.sort : "adherence";
  const descending =
    query.dir === "desc" ? true : query.dir === "asc" ? false : defaultDescending(sort);
  return {
    page: parseIntInRange(query.page, 0, 0, Number.MAX_SAFE_INTEGER),
    limit: parseIntInRange(query.limit, ROSTER_DEFAULT_LIMIT, 1, ROSTER_MAX_LIMIT),
    search: typeof query.search === "string" ? query.search.trim().slice(0, ROSTER_SEARCH_MAX_LENGTH) : "",
    sort,
    descending,
    weakest: ROSTER_DIMENSIONS.includes(query.weakest) ? query.weakest : null,
    onlyWithAlerts: parseFlag(query.alerts),
    onlyOverdueCheckin: parseFlag(query.overdue),
    onlyWithPending: parseFlag(query.pending),
  };
}

// Sin tildes ni mayúsculas: "jose" encuentra a "José".
function normalizeForSearch(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function pendingOf(row) {
  return (row.pendingCheckins || 0) + (row.pendingFormChecks || 0);
}

// Intake sin enviar o por revisar: todavía no hay seguimiento. Esas filas
// no entran en la tabla, van al bloque "Pendientes" de encima.
function isGated(row) {
  return row.intakeStatus === "pending" || row.intakeStatus === "submitted";
}

function sortValueFor(row, key) {
  switch (key) {
    case "adherence":
      return row.adherence.overall;
    case "weight":
      return row.weightChange ? row.weightChange.absolute : null;
    case "checkin":
      return row.daysSinceCheckin;
    case "sessions":
      return row.sessions;
    case "review":
      return pendingOf(row);
    case "alerts":
      // Las urgentes desempatan: 1 urgente pesa más que 2 menores, y sin
      // esto quedarían mezcladas en el mismo escalón.
      return row.openAlerts + row.urgentAlerts * 0.5;
    default:
      return null;
  }
}

function compareRows(sort, descending) {
  const direction = descending ? -1 : 1;
  const byName = (a, b) => nameCollator.compare(a.clientName, b.clientName);

  return (a, b) => {
    if (sort === "name") return byName(a, b) * direction;

    const left = sortValueFor(a, sort);
    const right = sortValueFor(b, sort);

    // Los nulos van SIEMPRE al final, se ordene como se ordene — por eso se
    // resuelven ANTES de aplicar la dirección. Un cliente sin datos no es
    // "el mejor" ni "el peor": es el que todavía no se puede comparar.
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    // Empate a número: por nombre, para que el orden sea estable y la tabla
    // no baile entre páginas.
    return (left - right) * direction || byName(a, b);
  };
}

function matchesFilters(row, filters) {
  if (filters.weakest && row.adherence.weakest !== filters.weakest) return false;
  if (filters.onlyWithAlerts && !row.openAlerts) return false;
  if (filters.onlyOverdueCheckin && (row.daysSinceCheckin ?? 0) <= OVERDUE_CHECKIN_DAYS) return false;
  if (filters.onlyWithPending && !pendingOf(row)) return false;
  return true;
}

/**
 * De las filas de buildRoster a la respuesta paginada.
 *
 * - `pending`: el bloque "Pendientes" (intake sin enviar o por revisar),
 *   COMPLETO y fuera de la paginación: es la lista de cosas por hacer, y
 *   búsqueda y filtros nunca la han tocado.
 * - `clients`: la página pedida, ya filtrada y ordenada.
 * - `total`: filas que cumplen búsqueda + filtros (para el paginador).
 * - `totalActive`: filas de la tabla sin búsqueda ni filtros, para
 *   distinguir "no tienes clientes" de "ninguno coincide".
 * - `counts`: cuántos quedarían al elegir cada opción del panel de filtros,
 *   con la búsqueda y el resto de filtros como están. Antes los contaba el
 *   navegador sobre la cartera entera; ahora ya no la tiene.
 *
 * Una página fuera de rango (se rechazó al último cliente de la última
 * página, por ejemplo) devuelve la última que existe, y `page` dice cuál.
 */
function paginateRoster(rows, options) {
  const pending = rows
    .filter(isGated)
    // Por revisar primero (te toca a ti), luego sin enviar (se espera al
    // cliente).
    .sort((a, b) => Number(b.intakeStatus === "submitted") - Number(a.intakeStatus === "submitted"));
  const active = rows.filter((row) => !isGated(row));

  const search = normalizeForSearch(options.search);
  const searched = search
    ? active.filter((row) => normalizeForSearch(`${row.clientName} ${row.clientEmail}`).includes(search))
    : active;

  const filters = {
    weakest: options.weakest,
    onlyWithAlerts: options.onlyWithAlerts,
    onlyOverdueCheckin: options.onlyOverdueCheckin,
    onlyWithPending: options.onlyWithPending,
  };
  const countWith = (override) => searched.filter((row) => matchesFilters(row, { ...filters, ...override })).length;

  const matching = searched.filter((row) => matchesFilters(row, filters)).sort(compareRows(options.sort, options.descending));

  const lastPage = Math.max(0, Math.ceil(matching.length / options.limit) - 1);
  const page = Math.min(options.page, lastPage);
  const start = page * options.limit;

  return {
    pending,
    clients: matching.slice(start, start + options.limit),
    total: matching.length,
    totalActive: active.length,
    page,
    limit: options.limit,
    sort: options.sort,
    descending: options.descending,
    counts: {
      weakest: {
        any: countWith({ weakest: null }),
        ...Object.fromEntries(ROSTER_DIMENSIONS.map((key) => [key, countWith({ weakest: key })])),
      },
      alerts: countWith({ onlyWithAlerts: true }),
      overdue: countWith({ onlyOverdueCheckin: true }),
      pending: countWith({ onlyWithPending: true }),
    },
  };
}

module.exports = {
  ROSTER_WINDOW_DAYS,
  buildRoster,
  parseRosterQuery,
  paginateRoster,
  // Exportadas para test unitario — son las dos piezas con criterio propio.
  weightChangeFor,
  daysSince,
};
