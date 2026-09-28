const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinAgenda = require("../trainerCheckins/checkin-agenda-service");
const { weekForClientAt } = require("../planAssignments/week-service");
const DietTemplate = require("../dietTemplates/diet-template-schema");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const { isRequestPending } = require("../nutritionPreferences/request-status");
const trainerPaymentService = require("../trainerPayments/trainer-payment-service");
const paymentReminders = require("../trainerPayments/trainer-payment-reminder-service");
const userSchema = require("../users/schema");
const Table = require("../tables/table-schema");
const routineAssignmentDao = require("../routineAssignments/routine-assignment-dao");
const { isoDate } = require("../util/date-util");
const { pickTrainingPlan, pickNutritionPlan } = require("./current-plans");

module.exports = {
  // GET /coach/dashboard — cliente autenticado. Agrega, de TODOS sus
  // profesionales con relación ACTIVA, todo lo que hoy vive disperso en
  // pantallas separadas (check-ins, comidas propuestas, preferencias,
  // cobros, rutina y dieta asignadas). No introduce ninguna colección
  // nueva ni modifica lógica de negocio existente — es una capa de
  // agregación de solo lectura sobre DAOs/servicios ya construidos.
  async getDashboard(req, res) {
    const clientId = req.auth.userId;

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
    const today = checkinAgenda.todayIso();
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

    // --- Propuestas de comida pendientes de elegir ---
    const mealProposalsRaw = await mealProposalDao.listAllPendingForClient(clientId);
    const pendingMealProposals = mealProposalsRaw
      .filter((p) => activeTrainerIdSet.has(String(p.trainerId)))
      .map((p) => {
        touchActivity(p.trainerId, p.createdAt);
        return {
          proposalId: p._id,
          date: p.date,
          mealSlot: p.mealSlot,
          alternativesCount: p.alternatives.length,
          trainerName: trainerName(p.trainerId),
        };
      });

    // --- Preferencias nutricionales solicitadas ---
    const preferences = await nutritionPreferencesDao.getByClientId(clientId);
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

    const [user, routinePhases, assignedTables] = await Promise.all([
      userSchema.findById(clientId).select("tableInUse").lean(),
      routineAssignmentDao.listByClient(clientId),
      Table.find({ userId: clientId, assignedByTrainerId: { $in: activeTrainerIds } }).select("_id").lean(),
    ]);
    const training = pickTrainingPlan({
      tableInUseId: user?.tableInUse,
      phases: routinePhases,
      assignedTables: assignedTables.map((t) => ({ tableId: t._id, assignedAt: t._id.getTimestamp() })),
      today,
    });
    if (training) {
      const table = await Table.findById(training.tableId).select("name assignedByTrainerId").lean();
      if (table?.assignedByTrainerId && activeTrainerIdSet.has(String(table.assignedByTrainerId))) {
        // Table no tiene createdAt: asignar siempre crea una copia nueva, así
        // que sin fase de rutina la fecha es la del ObjectId.
        const assignedAt = table._id.getTimestamp();
        touchActivity(table.assignedByTrainerId, assignedAt);
        currentPlans.training = {
          status: training.status,
          name: table.name,
          assignedByTrainerName: trainerName(table.assignedByTrainerId),
          startDate: training.startDate || isoDate(assignedAt),
        };
      }
    }

    // lean(): sin autopopular los menús, aquí solo hacen falta fechas y nombres.
    const dietDocs = await DietTemplate.find({ clientId })
      .select("phaseId phaseName name trainerId startDate endDate createdAt")
      .lean();
    const nutrition = pickNutritionPlan({ docs: dietDocs, today });
    if (nutrition && activeTrainerIdSet.has(String(nutrition.head.trainerId))) {
      const { head } = nutrition;
      touchActivity(head.trainerId, head.createdAt);
      currentPlans.nutrition = {
        status: nutrition.status,
        name: head.phaseName || head.name,
        assignedByTrainerName: trainerName(head.trainerId),
        startDate: head.startDate,
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

    return res.send({
      professionals: professionalsWithActivity,
      pendingCheckins,
      pendingMealProposals,
      nutritionPreferences,
      pendingPayments,
      currentPlans,
    });
  },

};
