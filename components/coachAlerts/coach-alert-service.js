const coachAlertDao = require("./coach-alert-dao");
const { planAlertWrites } = require("./alert-write-plan");
const { SIGNAL_THRESHOLDS, buildSignalsForClient } = require("./coach-signals-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinDao = require("../trainerCheckins/checkin-dao");
const checkinAgenda = require("../trainerCheckins/checkin-agenda-service");
const CheckinSchedule = require("../trainerCheckins/checkin-schedule-schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const dietDaysDao = require("../dietDays/diet-days-dao");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const userSchema = require("../users/schema");
const { runRulesForTrainer } = require("../coachRules/coach-rule-service");
const tableDao = require("../tables/table-dao");
const painDao = require("../painLog/pain-dao");
const { isoDate } = require("../util/date-util");

// Días de silencio tras un cierre MANUAL de una alerta antes de que el
// evaluador pueda volver a abrirla. Si el coach mira un estancamiento y
// decide "ya lo sé, lo reviso en dos semanas", el sistema debe respetarlo —
// sin esto, la alerta reaparecería a la mañana siguiente y el coach dejaría
// de leer el panel. Ver coach-alert-dao#findLastManuallyClosedByDedupeKey
// para por qué los cierres automáticos NO cuentan aquí.
const ALERT_COOLDOWN_DAYS = 14;

function isoDaysAgo(days, now) {
  const date = new Date(now.getTime() - days * 86400000);
  return date.toISOString().slice(0, 10);
}

function fullName(user) {
  return `${user?.name || ""} ${user?.lastname || ""}`.trim() || "Este cliente";
}

// El nombre de pila basta para las frases de alerta ("Juan lleva 3 semanas
// sin bajar") — el apellido las alarga sin añadir información, el coach ya
// sabe de quién habla al ver la fila.
function shortName(user) {
  return user?.name?.trim() || fullName(user);
}

function dedupeKeyFor(trainerId, clientId, type) {
  return `${trainerId}:${clientId}:${type}`;
}

/**
 * Carga en BLOQUE todo lo que necesitan las señales de los clientes de un
 * profesional. El plan de consultas es la parte crítica de este módulo:
 * corre dentro de la petición del entrenador (evaluación diaria bajo
 * demanda y la Cartera), y la forma ingenua (recalcular cliente a cliente lo
 * que ya calculan los endpoints de la ficha) sería un fan-out de cientos de
 * consultas por profesional.
 *
 * Coste real: 11 consultas fijas en dos tandas paralelas, ninguna por
 * cliente. La adherencia nutricional era la excepción (una consulta en
 * cascada por cliente, en serie) hasta dietDaysDao#listTrackingDaysForUsers.
 *
 * Lo que NO se usa aquí, a propósito:
 *   - getTrackingDaysForClient (trainer-client-data-controller.js): resuelve
 *     el plan al vuelo para cada fecha sin DietDay materializado, y cada
 *     resolución son 3 consultas más una DietTemplate con la cascada entera
 *     de autopopulate. Correcto para UN cliente y UN rango en una ficha
 *     abierta; ruinoso para 30 clientes × 28 días. Aquí se leen solo los
 *     días REALMENTE materializados, que además es el dato correcto para
 *     esta señal: un día que nadie abrió no tiene consumo que medir, y ese
 *     silencio ya lo recoge la señal de inactividad.
 *   - El recorrido Table -> splits -> workouts para saber si el cliente
 *     entrena: ver el comentario de detectInactivity en
 *     coach-signals-service.js.
 */
async function loadTrainerContext(trainerId, now) {
  const windowStart = isoDaysAgo(SIGNAL_THRESHOLDS.analysisWindowDays, now);

  const [
    activeClients,
    pendingReviewRelations,
    checkinSchedules,
    answeredOccurrences,
    latestResponses,
    checkinResponses,
  ] = await Promise.all([
    trainerClientService.listActiveClientsForTrainer(trainerId),
    trainerClientDao.findByTrainerAndStatusWithClient(trainerId, "en_revision"),
    CheckinSchedule.find({ trainerId }).lean(),
    checkinDao.listAnsweredOccurrences(trainerId, windowStart),
    checkinDao.getLatestResponseByClient(trainerId),
    // Fase 3 — los VALORES de las respuestas, no solo sus fechas: las reglas
    // del coach pueden condicionar sobre bienestar (estrés, sueño, pasos).
    // Una consulta para toda la cartera, no una por cliente.
    checkinDao.listResponsesForTrainerSince(
      trainerId,
      new Date(now.getTime() - SIGNAL_THRESHOLDS.analysisWindowDays * 86400000)
    ),
  ]);

  const clientIds = activeClients.filter((entry) => entry.user).map((entry) => entry.user._id);

  const [anthropometryEntries, clientUsers, workoutDates, painEntries, trackingDays] = await Promise.all([
    anthropometryDao.listForUsersSince(clientIds, windowStart),
    // Solo para saber SI el cliente tiene rutina (detectNoTrainingActivity)
    // y para la Cartera — ver roster-service.js.
    userSchema.find({ _id: { $in: clientIds } }).select("tableInUse").lean(),
    // Fase 6 — sesiones entrenadas de TODA la cartera en una agregación,
    // para que el motor de reglas pueda condicionar sobre entrenamiento sin
    // una consulta por cliente. El volumen y los PRs siguen fuera del job:
    // ver rule-metric-catalog.js#training_sessions.
    tableDao.listCompletedWorkoutDatesForUsers(
      clientIds,
      new Date(`${windowStart}T00:00:00.000Z`),
      now
    ),
    // Movimiento 3 Coach Pro — el dolor de TODA la cartera en una consulta,
    // para que el motor de reglas pueda condicionar sobre él (métrica
    // pain_max). Mismo criterio que las sesiones de arriba: entra en la
    // evaluación porque su consulta es barata en lote.
    painDao.listForUsersSince(clientIds, windowStart),
    // Adherencia nutricional de toda la cartera: una agregación con solo las
    // marcas de cumplimiento, sin el árbol de autopopulate.
    dietDaysDao.listTrackingDaysForUsers(clientIds, windowStart, isoDate(now)),
  ]);

  const anthropometryByClient = groupBy(anthropometryEntries, (entry) => String(entry.userId));
  const tableIdByClient = new Map(
    clientUsers.map((user) => [String(user._id), user.tableInUse]).filter(([, table]) => table)
  );

  // Todos los clientes llevan adherencia, también los que no tienen días
  // (percentage null, daysWithData 0): la Cartera y lastActivityFor
  // distinguen "sin datos" de "sin cliente".
  const trackingDaysByClient = groupBy(trackingDays, (day) => String(day.userId));
  const adherenceByClient = new Map(
    clientUsers.map((user) => {
      const clientKey = String(user._id);
      const days = trackingDaysByClient.get(clientKey) || [];
      return [
        clientKey,
        dietDaysNutritionUtil.computeRangeAdherence(days, SIGNAL_THRESHOLDS.analysisWindowDays),
      ];
    })
  );

  return {
    activeClients,
    pendingReviewRelations,
    // Programaciones y solicitudes ya respondidas por cliente: con eso se
    // sabe qué ventanas se cerraron vacías (checkin_overdue) sin una
    // consulta por cliente.
    schedulesByClient: groupBy(checkinSchedules, (s) => String(s.clientId)),
    answeredByClient: new Map(
      [...groupBy(answeredOccurrences, (r) => String(r.clientId))].map(([key, rows]) => [
        key,
        new Set(rows.map((r) => `${r.scheduleId}:${r.occurrenceDate}`)),
      ])
    ),
    lastResponseByClient: new Map(latestResponses.map((r) => [String(r._id), r.respondedAt])),
    anthropometryByClient,
    adherenceByClient,
    checkinResponsesByClient: groupBy(checkinResponses, (r) => String(r.clientId)),
    workoutDatesByClient: groupBy(workoutDates, (row) => String(row.userId)),
    painEntriesByClient: groupBy(painEntries, (row) => String(row.userId)),
    // Lo consume la Cartera (roster-service.js) y, desde la auditoría
    // 2026-09, detectNoTrainingActivity (solo para saber SI hay rutina, no
    // recorre su contenido).
    tableIdByClient,
  };
}

// Última señal de vida del cliente, a partir de datos YA cargados — sin
// ninguna consulta extra. Cubre las tres formas en que un cliente "aparece":
// responder un check-in, registrar una medida, o que su plan de nutrición
// tenga días materializados (alguien abrió la app ese día).
function lastActivityFor({ lastResponseAt, entries, adherence, now }) {
  const candidates = [];
  if (lastResponseAt) candidates.push(new Date(lastResponseAt));
  if (entries?.length) candidates.push(new Date(`${entries[entries.length - 1].date}T00:00:00.000Z`));
  // Si hay días de dieta con plan en la ventana, el cliente ha estado
  // presente; no se sabe exactamente cuándo, así que se toma el borde
  // optimista (no marcar inactivo a alguien que sí está registrando).
  if (adherence?.daysWithData > 0) return now;
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Un "snapshot" por cliente: todo lo que se sabe de él en esta pasada,
 * ensamblado UNA vez.
 *
 * Lo consumen dos cosas distintas —las 8 señales integradas y el motor de
 * reglas del coach (Fase 3)— y ambas necesitan exactamente los mismos
 * datos. Montarlo dos veces habría sido la vía directa a que una de las dos
 * mirase una versión distinta del mismo cliente.
 */
function buildClientSnapshots(context, now) {
  const snapshots = [];

  // Clientes en alta (status "en_revision"): todavía no están en
  // activeClients, y de ellos solo se sabe que esperan confirmación.
  for (const relation of context.pendingReviewRelations) {
    if (!relation.clientId) continue;
    snapshots.push({
      clientId: relation.clientId._id,
      clientName: fullName(relation.clientId),
      shortName: shortName(relation.clientId),
      relationStatus: "en_revision",
      now,
      entries: [],
      checkinResponses: [],
    });
  }

  for (const entry of context.activeClients) {
    if (!entry.user) continue;
    const clientKey = String(entry.user._id);
    const entries = context.anthropometryByClient.get(clientKey) || [];
    const adherence = context.adherenceByClient.get(clientKey) || null;
    const lastResponseAt = context.lastResponseByClient.get(clientKey) || null;
    const schedules = context.schedulesByClient.get(clientKey) || [];
    const today = isoDate(now);
    const missed = checkinAgenda.missedOccurrences(
      schedules,
      context.answeredByClient.get(clientKey) || new Set(),
      today
    );
    const checkin = schedules.length
      ? {
          ...missed,
          nextDate: checkinAgenda.nextOccurrenceForClient(schedules, today),
          lastResponseAt,
        }
      : null;

    snapshots.push({
      clientId: entry.user._id,
      clientName: fullName(entry.user),
      // El buscador de la Cartera busca también por correo: hay clientes
      // que el trainer tiene fichados por su email, no por su nombre.
      clientEmail: entry.user.email || "",
      shortName: shortName(entry.user),
      relationStatus: "active",
      intakePending: Boolean(entry.intakePending),
      now,
      entries,
      adherence,
      lastResponseAt,
      checkin,
      checkinResponses: context.checkinResponsesByClient.get(clientKey) || [],
      // Fase 6 — solo las FECHAS de las sesiones: es lo que necesita la
      // métrica de regla "sesiones entrenadas" y ahora también
      // detectNoTrainingActivity, y lo único que sale barato para toda la
      // cartera.
      workoutDates: (context.workoutDatesByClient?.get(clientKey) || []).map((row) => row.date),
      // Auditoría 2026-09 — ya se cargaba para la Cartera (tableIdByClient)
      // pero no viajaba a los snapshots; detectNoTrainingActivity lo necesita
      // para no avisar de "no entrena" a quien ni siquiera tiene rutina.
      hasRoutine: Boolean(context.tableIdByClient?.get(clientKey)),
      // Movimiento 3 Coach Pro — solo fecha, zona y nivel: es lo que
      // necesita la métrica pain_max y lo único barato para toda la cartera.
      painEntries: context.painEntriesByClient?.get(clientKey) || [],
      lastActivityAt: lastActivityFor({ lastResponseAt, entries, adherence, now }),
    });
  }

  return snapshots;
}

/**
 * Las 8 señales integradas, a partir de snapshots ya montados.
 *
 * Separada de buildClientSnapshots porque evaluateTrainer necesita los
 * snapshots DOS veces: para esto y para el motor de reglas. Montarlos aquí
 * dentro obligaría a montarlos dos veces o a duplicar este mapeo — que es
 * justamente lo que pasó al añadir las reglas y se corrige aquí.
 */
function buildSignalsFromSnapshots(snapshots) {
  return snapshots.map((snapshot) => ({
    clientId: snapshot.clientId,
    clientName: snapshot.clientName,
    signals: buildSignalsForClient({
      clientName: snapshot.shortName,
      relationStatus: snapshot.relationStatus,
      now: snapshot.now,
      entries: snapshot.entries,
      adherence: snapshot.adherence,
      checkin: snapshot.checkin,
      lastActivityAt: snapshot.lastActivityAt,
      hasRoutine: snapshot.hasRoutine,
      workoutDates: snapshot.workoutDates,
    }),
  }));
}

/**
 * Persiste las señales de un profesional: crea las nuevas, refresca las que
 * siguen vigentes, respeta el silencio de las cerradas a mano y cierra las
 * que ya no aplican. Idempotente — ejecutarlo dos veces seguidas no cambia
 * nada la segunda vez. Coste fijo: 2 lecturas y 2 escrituras, tenga el
 * profesional 3 alertas o 60 (antes, 2 consultas en serie por alerta).
 */
async function persistSignals(trainerId, clientSignals, now) {
  const [openIdByKey, silencedKeys] = await Promise.all([
    coachAlertDao.listOpenIdsByKey(trainerId, { fromRules: false }),
    coachAlertDao.listManuallyClosedKeysSince(
      trainerId,
      new Date(now.getTime() - ALERT_COOLDOWN_DAYS * 86400000)
    ),
  ]);

  const candidates = clientSignals.flatMap(({ clientId, signals }) =>
    signals.map((signal) => ({
      trainerId,
      clientId,
      type: signal.type,
      priority: signal.priority,
      reason: signal.reason,
      context: signal.context,
      dedupeKey: dedupeKeyFor(trainerId, clientId, signal.type),
    }))
  );

  const plan = planAlertWrites(candidates, { openIdByKey, silencedKeys, now });
  const result = await coachAlertDao.applyWritePlan(trainerId, plan, { fromRules: false });
  return { ...result, skippedByCooldown: plan.skipped };
}

/**
 * Evalúa un único profesional. `context` permite reutilizar uno ya cargado
 * (la Cartera lo tiene en la mano); sin él, se carga aquí.
 */
async function evaluateTrainer(trainerId, now = new Date(), context = null) {
  const loaded = context || (await loadTrainerContext(trainerId, now));
  const snapshots = buildClientSnapshots(loaded, now);
  const signalResult = await persistSignals(
    trainerId,
    buildSignalsFromSnapshots(snapshots),
    now
  );

  // Fase 3 — las reglas del propio coach, sobre los MISMOS snapshots. Cero
  // consultas de carga adicionales. Se ejecutan después de las señales
  // integradas para que un fallo aquí no impida que aquellas se hayan
  // guardado ya: son dos sistemas independientes que comparten datos, no
  // uno que dependa del otro.
  const ruleResult = await runRulesForTrainer(trainerId, snapshots, now);

  return { ...signalResult, rules: ruleResult };
}

// --- Evaluación bajo demanda (sin cron) ---
//
// Antes un cron a las 05:00 evaluaba a TODOS los profesionales con clientes,
// abrieran la app o no. Ahora la primera lectura de alertas del día de cada
// profesional (panel, Cartera, resumen del cliente) lo evalúa, y el resto
// del día se lee lo ya escrito. Misma frescura que el cron (una vez al día:
// las señales por tiempo cuentan días), coste solo para quien mira, y ningún
// proceso programado.
//
// El estado vive en memoria a propósito: perderlo (reinicio, despliegue)
// solo cuesta repetir una evaluación idempotente, y consultarlo no cuesta ni
// una consulta por petición. Con varios procesos, cada uno evaluaría una vez
// al día: trabajo repetido, nunca alertas duplicadas (índice único parcial
// de dedupeKey, y applyWritePlan ignora ese E11000).
//
// Peticiones simultáneas del mismo profesional (el panel y la Cartera a la
// vez) se unen a la evaluación en curso en vez de lanzar otra.
const evaluations = new Map(); // String(trainerId) -> { day, pending, promise }

function startEvaluation(trainerId, now, context) {
  const key = String(trainerId);
  const entry = { day: isoDate(now), pending: true, promise: null };
  entry.promise = evaluateTrainer(trainerId, now, context).then(
    (result) => {
      entry.pending = false;
      return result;
    },
    (error) => {
      // Sin marca: la siguiente lectura lo reintenta.
      if (evaluations.get(key) === entry) evaluations.delete(key);
      throw error;
    }
  );
  evaluations.set(key, entry);
  return entry.promise;
}

/**
 * Garantiza que las alertas del profesional están evaluadas HOY antes de
 * leerlas. Si ya lo están, no toca la BD. Nunca lanza: si la evaluación
 * falla se registra y se sirven las alertas que ya había — un fallo aquí no
 * debe dejar al entrenador sin panel.
 *
 * `context`: si quien llama ya cargó loadTrainerContext (la Cartera), se
 * reutiliza y la evaluación no vuelve a leer nada de los clientes.
 */
async function ensureEvaluatedToday(trainerId, { now = new Date(), context = null } = {}) {
  const current = evaluations.get(String(trainerId));
  const promise =
    current?.day === isoDate(now) ? current.promise : startEvaluation(trainerId, now, context);
  try {
    await promise;
  } catch (error) {
    console.error("[coach-alerts] fallo evaluando al profesional:", String(trainerId), error.message);
  }
}

/** "Revisar ahora": evalúa ya, salvo que haya una evaluación en curso, a la que se une. */
function evaluateNow(trainerId, now = new Date()) {
  const current = evaluations.get(String(trainerId));
  return current?.pending ? current.promise : startEvaluation(trainerId, now, null);
}

// --- helper privado ---
function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

module.exports = {
  ALERT_COOLDOWN_DAYS,
  evaluateTrainer,
  ensureEvaluatedToday,
  evaluateNow,
  // Reutilizada por clientProgress/roster-service (la Cartera): carga el
  // mismo contexto del entrenador con el presupuesto de consultas de
  // arriba. No la copies: si diverge, la Cartera y las alertas dejan de
  // contar lo mismo.
  loadTrainerContext,
  // Exportadas para test unitario (puras, sin BD).
  buildClientSnapshots,
  buildSignalsFromSnapshots,
  lastActivityFor,
  dedupeKeyFor,
};
