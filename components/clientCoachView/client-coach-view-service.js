const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinAgenda = require("../trainerCheckins/checkin-agenda-service");
const { weekForClientAt } = require("../dietPhases/week-service");
const dietPhaseService = require("../dietPhases/diet-phase-service");
const nutritionPreferencesService = require("../nutritionPreferences/nutrition-preferences-service");
const { isRequestPending } = require("../nutritionPreferences/request-status");
const trainerPaymentService = require("../trainerPayments/trainer-payment-service");
const paymentReminders = require("../trainerPayments/trainer-payment-reminder-service");
const tableService = require("../tables/table-service");
const routineAssignmentService = require("../routineAssignments/routine-assignment-service");
const { routineInUseOfId } = require("../routineAssignments/routine-in-use");
const { isoDateInZone, todayIsoDate } = require("../util/date-util");
const userDao = require("../users/user-dao");
const { pickTrainingPlan, pickNutritionPlan } = require("./current-plans");
const { trainingTimeline, nutritionTimeline } = require("./plan-timeline");

/**
 * Qué rutina y qué fase de dieta rigen hoy (current-plans.js), con su tabla
 * o su fase. Solo cuenta lo de un profesional con relación activa: lo de uno
 * ya desvinculado no es "tu plan".
 */
async function pickCurrentPlans({ clientId, today, activeTrainerIds, routinePhases, dietPhases }) {
  const activeTrainerIdSet = new Set(activeTrainerIds.map(String));
  const [routine, assignedTables] = await Promise.all([
    routineInUseOfId(clientId),
    tableService.listIdsAssignedBy(clientId, activeTrainerIds),
  ]);

  let training = null;
  const pickedTraining = pickTrainingPlan({
    tableInUseId: routine.tableInUse,
    phases: routinePhases,
    assignedTables: assignedTables.map((t) => ({ tableId: t._id, assignedAt: t._id.getTimestamp() })),
    today,
  });
  if (pickedTraining) {
    const table = await tableService.findSummary(pickedTraining.tableId);
    if (table?.assignedByTrainerId && activeTrainerIdSet.has(String(table.assignedByTrainerId))) {
      training = { ...pickedTraining, table };
    }
  }

  const pickedNutrition = pickNutritionPlan({ phases: dietPhases, today });
  const nutrition =
    pickedNutrition && activeTrainerIdSet.has(String(pickedNutrition.phase.trainerId)) ? pickedNutrition : null;

  return { training, nutrition };
}

/**
 * El tab Coach del cliente: de TODOS sus profesionales con relación ACTIVA,
 * lo que hoy vive disperso en pantallas separadas (check-ins pendientes,
 * preferencias pedidas, cobros pendientes, rutina y dieta actuales) y la
 * última actividad de cada uno. Solo lectura, salvo las cuotas que ya tocan,
 * que se generan al abrirlo (sin cron). `timeZone`: la del cliente.
 */
async function dashboard(clientId, timeZone) {

  const professionals = await trainerClientService.listActiveProfessionalsForClient(clientId);
  const activeTrainerIds = professionals.map((p) => p.user?._id).filter(Boolean);
  const activeTrainerIdSet = new Set(activeTrainerIds.map(String));
  const nameByTrainerId = new Map(
    professionals
      .filter((p) => p.user)
      .map((p) => [String(p.user._id), `${p.user.name} ${p.user.lastname}`.trim()])
  );

  const lastActivityByTrainer = new Map();
  const touchActivity = (trainerId, date) => {
    if (!trainerId || !date) return;
    const key = String(trainerId);
    const time = new Date(date).getTime();
    if (Number.isNaN(time)) return;
    if (!lastActivityByTrainer.has(key) || lastActivityByTrainer.get(key) < time) {
      lastActivityByTrainer.set(key, time);
    }
  };
  const trainerName = (trainerId) => nameByTrainerId.get(String(trainerId)) || "Tu profesional";

  // --- Check-ins pendientes ---
  // Pendiente = hay una solicitud ABIERTA hoy (su ventana de fechas incluye
  // hoy) todavía sin responder, o respondida y aún editable. No hay push ni
  // recordatorio: el aviso se calcula al abrir la app.
  const today = todayIsoDate(timeZone);
  const week = await weekForClientAt(clientId, today);
  const open = await checkinAgenda.openForClient(clientId, today, activeTrainerIds.map(String));
  const pendingCheckins = [];
  for (const { schedule, entry, response } of open) {
    touchActivity(schedule.trainerId, response?.updatedAt || schedule.updatedAt);
    if (response) continue;
    pendingCheckins.push({
      trainerId: schedule.trainerId,
      trainerName: trainerName(schedule.trainerId),
      scheduleId: String(schedule._id),
      name: schedule.name,
      date: entry.date,
      closesDate: entry.closesDate,
      ...(week ? { weekNumber: week.number, weekStart: week.start, weekEnd: week.end } : {}),
    });
  }

  // --- Preferencias nutricionales solicitadas ---
  const preferences = await nutritionPreferencesService.getForClient(clientId);
  let nutritionPreferences = null;
  if (preferences?.requestedAt && activeTrainerIdSet.has(String(preferences.requestedBy))) {
    touchActivity(preferences.requestedBy, preferences.requestedAt);
    nutritionPreferences = {
      requestedAt: preferences.requestedAt,
      respondedAt: preferences.respondedAt,
      pending: isRequestPending(preferences),
      requestedByName: trainerName(preferences.requestedBy),
    };
  }

  // --- Cobros pendientes ---
  // Lectura informativa de siempre, con el SALDO RESTANTE real (tras pagos
  // parciales; sin cobros liquidados, cancelados ni anulados). Nunca notas
  // privadas, métodos ni movimientos: el cliente no gestiona cobros.
  // Sin cron: las cuotas que ya tocan se generan aquí, al abrir el Coach.
  let pendingPayments = [];
  try {
    await paymentReminders.ensureClientUpToDate(clientId);
    const pending = await trainerPaymentService.listCoachPending(clientId, activeTrainerIds, trainerName);
    pendingPayments = pending.items;
    for (const { trainerId, at } of pending.activity) touchActivity(trainerId, at);
  } catch (error) {
    // Un fallo de cobros no tumba el resto del Coach.
    console.error("[Coach] No se pudieron cargar los cobros pendientes:", error.message);
  }

  // --- Tu plan actual: rutina y fase de dieta (current-plans.js) ---
  const currentPlans = { training: null, nutrition: null };

  const [routinePhases, dietPhases] = await Promise.all([
    routineAssignmentService.listForClient(clientId),
    dietPhaseService.listForClient(clientId),
  ]);
  const { training, nutrition } = await pickCurrentPlans({ clientId, today, activeTrainerIds, routinePhases, dietPhases });
  if (training) {
    const { table } = training;
    const assignedAt = table._id.getTimestamp();
    touchActivity(table.assignedByTrainerId, assignedAt);
    currentPlans.training = {
      status: training.status,
      name: table.name,
      assignedByTrainerName: trainerName(table.assignedByTrainerId),
      startDate: training.startDate || isoDateInZone(assignedAt, timeZone),
    };
  }

  if (nutrition) {
    const { phase } = nutrition;
    touchActivity(phase.trainerId, phase.createdAt);
    currentPlans.nutrition = {
      status: nutrition.status,
      name: phase.name,
      assignedByTrainerName: trainerName(phase.trainerId),
      startDate: phase.startDate,
    };
  }

  const professionalsWithActivity = professionals
    .filter((p) => p.user)
    .map((p) => ({
      trainerId: p.user._id,
      name: trainerName(p.user._id),
      scopes: p.scopes,
      lastActivityAt: lastActivityByTrainer.has(String(p.user._id))
        ? new Date(lastActivityByTrainer.get(String(p.user._id)))
        : null,
    }));

  return {
    professionals: professionalsWithActivity,
    pendingCheckins,
    nutritionPreferences,
    pendingPayments,
    currentPlans,
  };
}

/**
 * "Tus planes" (Coach > Tu plan actual): la rutina y la fase de dieta de hoy
 * (las mismas que el dashboard), las programadas y las anteriores
 * (plan-timeline.js). Las anteriores incluyen las de profesionales con los
 * que ya no trabaja: son el historial del cliente.
 */
async function plans(clientId, timeZone) {
  const today = todayIsoDate(timeZone);
  const professionals = await trainerClientService.listActiveProfessionalsForClient(clientId);
  const activeTrainerIds = professionals.map((p) => p.user?._id).filter(Boolean);
  const [routinePhases, dietPhases] = await Promise.all([
    routineAssignmentService.listForClient(clientId),
    dietPhaseService.listForClient(clientId),
  ]);
  const current = await pickCurrentPlans({ clientId, today, activeTrainerIds, routinePhases, dietPhases });
  const training = trainingTimeline({ phases: routinePhases, current: current.training, today });
  const nutrition = nutritionTimeline({ phases: dietPhases, current: current.nutrition, today });

  const trainingEntries = [training.current, ...training.upcoming, ...training.past].filter(Boolean);
  const tables = await tableService.listSummaries([...new Set(trainingEntries.map((entry) => entry.tableId))]);
  const tableById = new Map(tables.map((table) => [String(table._id), table]));

  // Rutina de hoy sin fase: la fecha es la de la tabla (asignar siempre crea
  // una copia nueva, y Table no tiene createdAt).
  for (const entry of trainingEntries) {
    const table = tableById.get(entry.tableId);
    if (!entry.trainerId && table?.assignedByTrainerId) entry.trainerId = String(table.assignedByTrainerId);
    if (!entry.startDate && table) entry.startDate = isoDateInZone(table._id.getTimestamp(), timeZone);
  }

  const trainerIds = [...new Set([...trainingEntries, nutrition.current, ...nutrition.upcoming, ...nutrition.past]
    .filter((entry) => entry?.trainerId)
    .map((entry) => entry.trainerId))];
  const users = await userDao.listFields(trainerIds, "name lastname");
  const nameById = new Map(users.map((user) => [String(user._id), `${user.name || ""} ${user.lastname || ""}`.trim()]));
  const trainerNameOf = (entry) => (entry.trainerId && nameById.get(entry.trainerId)) || null;

  // Una fase cuya rutina ya no existe no se puede enseñar.
  const withTable = (entry) => tableById.has(entry.tableId);
  const trainingView = (entry) => ({ ...entry, name: tableById.get(entry.tableId).name, trainerName: trainerNameOf(entry) });
  const nutritionView = (entry) => ({ ...entry, trainerName: trainerNameOf(entry) });

  return {
    today,
    training: {
      current: training.current && withTable(training.current) ? trainingView(training.current) : null,
      upcoming: training.upcoming.filter(withTable).map(trainingView),
      past: training.past.filter(withTable).map(trainingView),
    },
    nutrition: {
      current: nutrition.current ? nutritionView(nutrition.current) : null,
      upcoming: nutrition.upcoming.map(nutritionView),
      past: nutrition.past.map(nutritionView),
    },
  };
}

/**
 * Coach > Tus profesionales: lo que le cobra uno de sus profesionales en
 * curso (client-ledger-view.js). null si no lo es: un antiguo profesional no
 * se consulta desde aquí.
 */
async function professionalPayments(clientId, trainerId) {
  if (!(await trainerClientService.hasActiveClient(trainerId, clientId))) return null;
  await paymentReminders.ensureClientUpToDate(clientId);
  return trainerPaymentService.getLedgerForClient(trainerId, clientId);
}

module.exports = { dashboard, plans, professionalPayments };
