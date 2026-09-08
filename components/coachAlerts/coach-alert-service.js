const coachAlertDao = require("./coach-alert-dao");
const { SIGNAL_THRESHOLDS, buildSignalsForClient } = require("./coach-signals-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinDao = require("../trainerCheckins/checkin-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const dietDaysDao = require("../dietDays/diet-days-dao");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");
const userSchema = require("../users/schema");
const { runRulesForTrainer } = require("../coachRules/coach-rule-service");
const tableDao = require("../tables/table-dao");
const painDao = require("../painLog/pain-dao");

// Días de silencio tras un cierre MANUAL de una alerta antes de que el
// evaluador pueda volver a abrirla. Si el coach mira un estancamiento y
// decide "ya lo sé, lo reviso en dos semanas", el sistema debe respetarlo —
// sin esto, la alerta reaparecería a la mañana siguiente y el coach dejaría
// de leer el panel. Ver coach-alert-dao#findLastManuallyClosedByDedupeKey
// para por qué los cierres automáticos NO cuentan aquí.
const ALERT_COOLDOWN_DAYS = 14;

// Días de antelación con los que un plan de nutrición a punto de caducar
// genera alerta. Mismo valor que ya usaba getAttentionItems.
const PLAN_ENDING_LOOKAHEAD_DAYS = 7;

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
 * este job corre de noche sobre todos los profesionales de la plataforma, y
 * la forma ingenua (recalcular cliente a cliente lo que ya calculan los
 * endpoints de la ficha) sería un fan-out de cientos de consultas por
 * profesional.
 *
 * Coste real: 7 consultas fijas + 2 por cliente con dieta asignada.
 * (La séptima, el registro de dolor, entró en el Movimiento 3.)
 *
 * Lo que NO se usa aquí, a propósito:
 *   - getTrackingDaysForClient (trainer-client-data-controller.js): resuelve
 *     el plan al vuelo para cada fecha sin DietDay materializado, y cada
 *     resolución son 3 consultas más una DietTemplate con la cascada entera
 *     de autopopulate. Correcto para UN cliente y UN rango en una ficha
 *     abierta; ruinoso para 30 clientes × 28 días cada noche. Aquí se leen
 *     solo los días REALMENTE materializados, que además es el dato correcto
 *     para esta señal: un día que nadie abrió no tiene consumo que medir, y
 *     ese silencio ya lo recoge la señal de inactividad.
 *   - El recorrido Table -> splits -> workouts para saber si el cliente
 *     entrena: ver el comentario de detectInactivity en
 *     coach-signals-service.js.
 */
async function loadTrainerContext(trainerId, now) {
  const windowStart = isoDaysAgo(SIGNAL_THRESHOLDS.analysisWindowDays, now);

  const [
    activeClients,
    pendingReviewRelations,
    checkinConfigs,
    latestResponses,
    endingSoon,
    checkinResponses,
  ] = await Promise.all([
    trainerClientService.listActiveClientsForTrainer(trainerId),
    trainerClientDao.findByTrainerAndStatusWithClient(trainerId, "en_revision"),
    checkinDao.getAppliedConfigsForTrainer(trainerId),
    checkinDao.getLatestResponseByClient(trainerId),
    planAssignmentService.listEndingSoonForTrainer(trainerId, PLAN_ENDING_LOOKAHEAD_DAYS),
    // Fase 3 — los VALORES de las respuestas, no solo sus fechas: las reglas
    // del coach pueden condicionar sobre bienestar (estrés, sueño, pasos).
    // Una consulta para toda la cartera, no una por cliente.
    checkinDao.listResponsesForTrainerSince(
      trainerId,
      new Date(now.getTime() - SIGNAL_THRESHOLDS.analysisWindowDays * 86400000)
    ),
  ]);

  const clientIds = activeClients.filter((entry) => entry.user).map((entry) => entry.user._id);

  const [anthropometryEntries, clientDiets, workoutDates, painEntries] = await Promise.all([
    anthropometryDao.listForUsersSince(clientIds, windowStart),
    // tableInUse va en el MISMO select que dietInUse (no en una consulta
    // aparte): la vista de Cartera lo necesita para las sesiones prescritas
    // y traerlo aquí no cuesta ni una consulta más. El evaluador nocturno lo
    // ignora — ver roster-service.js.
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
    // pain_max). Mismo criterio que las sesiones de arriba: entra en el
    // evaluador nocturno porque su consulta es barata en lote.
    painDao.listForUsersSince(clientIds, windowStart),
  ]);

  const anthropometryByClient = groupBy(anthropometryEntries, (entry) => String(entry.userId));
  const dietIdByClient = new Map(
    // Sin wrapper, el "id de dieta" de un cliente ES su propio id.
    clientDiets.map((user) => [String(user._id), user._id])
  );
  const tableIdByClient = new Map(
    clientDiets.map((user) => [String(user._id), user.tableInUse]).filter(([, table]) => table)
  );

  // Adherencia: secuencial a propósito, no Promise.all sobre todos los
  // clientes. getFullyPopulatedDietDaysForDiet arrastra la cascada de
  // autopopulate (meals -> customProducts -> product, customRecipes ->
  // recipe); lanzar 30 en paralelo puede saturar el pool de conexiones de
  // Mongoose y competir con el tráfico real de la app. De noche, la latencia
  // acumulada no le importa a nadie; un pico de conexiones sí.
  const adherenceByClient = new Map();
  for (const [clientKey, dietId] of dietIdByClient) {
    const days = await dietDaysDao.getFullyPopulatedDietDaysForUser(
      dietId,
      windowStart,
      now.toISOString().slice(0, 10)
    );
    adherenceByClient.set(
      clientKey,
      dietDaysNutritionUtil.computeRangeAdherence(days, SIGNAL_THRESHOLDS.analysisWindowDays)
    );
  }

  return {
    activeClients,
    pendingReviewRelations,
    checkinByClient: new Map(
      checkinConfigs.filter((c) => c.clientId).map((c) => [String(c.clientId._id), c])
    ),
    lastResponseByClient: new Map(latestResponses.map((r) => [String(r._id), r.respondedAt])),
    endingSoonByClient: new Map(
      endingSoon.filter((a) => a.clientId).map((a) => [String(a.clientId._id), a])
    ),
    anthropometryByClient,
    adherenceByClient,
    checkinResponsesByClient: groupBy(checkinResponses, (r) => String(r.clientId)),
    workoutDatesByClient: groupBy(workoutDates, (row) => String(row.userId)),
    painEntriesByClient: groupBy(painEntries, (row) => String(row.userId)),
    // Solo lo consume la Cartera (roster-service.js); las señales nocturnas
    // no miran la rutina asignada, ver detectInactivity.
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
    const config = context.checkinByClient.get(clientKey) || null;
    const endingSoon = context.endingSoonByClient.get(clientKey) || null;

    snapshots.push({
      clientId: entry.user._id,
      clientName: fullName(entry.user),
      // El buscador de la Cartera busca también por correo: hay clientes
      // que el trainer tiene fichados por su email, no por su nombre.
      clientEmail: entry.user.email || "",
      shortName: shortName(entry.user),
      relationStatus: "active",
      now,
      entries,
      adherence,
      lastResponseAt,
      checkinConfig: config,
      checkinResponses: context.checkinResponsesByClient.get(clientKey) || [],
      // Fase 6 — solo las FECHAS de las sesiones: es lo que necesita la
      // métrica de regla "sesiones entrenadas", y lo único que sale barato
      // para toda la cartera.
      workoutDates: (context.workoutDatesByClient?.get(clientKey) || []).map((row) => row.date),
      // Movimiento 3 Coach Pro — solo fecha, zona y nivel: es lo que
      // necesita la métrica pain_max y lo único barato para toda la cartera.
      painEntries: context.painEntriesByClient?.get(clientKey) || [],
      planEndingSoon: endingSoon
        ? { daysLeft: endingSoon.daysLeft, endDate: endingSoon.endDate }
        : null,
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
      checkin: snapshot.checkinConfig
        ? { config: snapshot.checkinConfig, lastResponseAt: snapshot.lastResponseAt }
        : null,
      planEndingSoon: snapshot.planEndingSoon,
      lastActivityAt: snapshot.lastActivityAt,
    }),
  }));
}

/**
 * Persiste las señales de un profesional: crea las nuevas, refresca las que
 * siguen vigentes, respeta el silencio de las cerradas a mano y cierra las
 * que ya no aplican. Idempotente — ejecutarlo dos veces seguidas no cambia
 * nada la segunda vez.
 */
async function persistSignals(trainerId, clientSignals, now) {
  const stillOpenKeys = [];
  let created = 0;
  let refreshed = 0;
  let skippedByCooldown = 0;

  for (const { clientId, signals } of clientSignals) {
    for (const signal of signals) {
      const dedupeKey = dedupeKeyFor(trainerId, clientId, signal.type);
      const existing = await coachAlertDao.findOpenByDedupeKey(dedupeKey);

      if (existing) {
        stillOpenKeys.push(dedupeKey);
        await coachAlertDao.refresh(existing._id, {
          reason: signal.reason,
          context: signal.context,
          priority: signal.priority,
          lastSeenAt: now,
        });
        refreshed++;
        continue;
      }

      const lastClosed = await coachAlertDao.findLastManuallyClosedByDedupeKey(dedupeKey);
      if (
        lastClosed?.resolvedAt &&
        now.getTime() - new Date(lastClosed.resolvedAt).getTime() <
          ALERT_COOLDOWN_DAYS * 86400000
      ) {
        skippedByCooldown++;
        continue;
      }

      await coachAlertDao.create({
        trainerId,
        clientId,
        type: signal.type,
        priority: signal.priority,
        reason: signal.reason,
        context: signal.context,
        dedupeKey,
        lastSeenAt: now,
        createdAt: now,
      });
      stillOpenKeys.push(dedupeKey);
      created++;
    }
  }

  // Lo que estaba abierto y ya no sale en la evaluación es un problema
  // resuelto solo (el cliente respondió, el coach confirmó el cuestionario,
  // el peso volvió a moverse). Se cierra sin nota ni autor.
  const autoResolved = await coachAlertDao.autoResolveMissing(trainerId, stillOpenKeys);

  return {
    created,
    refreshed,
    skippedByCooldown,
    autoResolved: autoResolved?.modifiedCount || 0,
  };
}

/** Evalúa un único profesional. Exportada para poder forzarla a mano. */
async function evaluateTrainer(trainerId, now = new Date()) {
  const context = await loadTrainerContext(trainerId, now);
  const snapshots = buildClientSnapshots(context, now);
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

/**
 * Job nocturno. Un profesional que falla NUNCA aborta el resto — mismo
 * criterio que runReminderJob en checkin-reminder-service.js.
 */
async function runAlertEvaluationJob(now = new Date()) {
  const trainerIds = await trainerClientDao.listTrainerIdsWithLiveClients();
  const totals = { trainers: trainerIds.length, created: 0, refreshed: 0, autoResolved: 0, failed: 0 };

  for (const trainerId of trainerIds) {
    try {
      const result = await evaluateTrainer(trainerId, now);
      totals.created += result.created;
      totals.refreshed += result.refreshed;
      totals.autoResolved += result.autoResolved;
    } catch (error) {
      totals.failed++;
      console.error("[coach-alerts] fallo evaluando al profesional:", String(trainerId), error.message);
    }
  }

  return totals;
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
  runAlertEvaluationJob,
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
