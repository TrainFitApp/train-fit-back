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
const { pickTrainingPlan, pickNutritionPlan } = require("./current-plans");

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
  // Solo cuenta lo de un profesional con relación activa: lo de uno ya
  // desvinculado no es "tu plan".
  const currentPlans = { training: null, nutrition: null };

  const [routine, routinePhases, assignedTables] = await Promise.all([
    routineInUseOfId(clientId),
    routineAssignmentService.listForClient(clientId),
    tableService.listIdsAssignedBy(clientId, activeTrainerIds),
  ]);
  const training = pickTrainingPlan({
    tableInUseId: routine.tableInUse,
    phases: routinePhases,
    assignedTables: assignedTables.map((t) => ({ tableId: t._id, assignedAt: t._id.getTimestamp() })),
    today,
  });
  if (training) {
    const table = await tableService.findSummary(training.tableId);
    if (table?.assignedByTrainerId && activeTrainerIdSet.has(String(table.assignedByTrainerId))) {
      // Table no tiene createdAt: asignar siempre crea una copia nueva, así
      // que sin fase de rutina la fecha es la del ObjectId.
      const assignedAt = table._id.getTimestamp();
      touchActivity(table.assignedByTrainerId, assignedAt);
      currentPlans.training = {
        status: training.status,
        name: table.name,
        assignedByTrainerName: trainerName(table.assignedByTrainerId),
        startDate: training.startDate || isoDateInZone(assignedAt, timeZone),
      };
    }
  }

  const nutrition = pickNutritionPlan({ phases: await dietPhaseService.listForClient(clientId), today });
  if (nutrition && activeTrainerIdSet.has(String(nutrition.phase.trainerId))) {
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

module.exports = { dashboard };
