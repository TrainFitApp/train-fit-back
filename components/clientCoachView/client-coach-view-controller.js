const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinAgenda = require("../trainerCheckins/checkin-agenda-service");
const { weekForClientAt } = require("../planAssignments/week-service");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const { isRequestPending } = require("../nutritionPreferences/request-status");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const userSchema = require("../users/schema");
const Table = require("../tables/table-schema");

module.exports = {
  // GET /coach/dashboard — cliente autenticado. Agrega, de TODOS sus
  // profesionales con relación ACTIVA, todo lo que hoy vive disperso en
  // pantallas separadas (check-ins, comidas propuestas, preferencias,
  // cobros, rutina/objetivo asignados). No introduce ninguna colección
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
    const paymentsRaw = await trainerPaymentDao.listPendingForClient(clientId);
    const pendingPayments = paymentsRaw
      .filter((p) => activeTrainerIdSet.has(String(p.trainerId)))
      .map((p) => {
        touchActivity(p.trainerId, p.createdAt);
        return {
          paymentId: p._id,
          amount: p.amount,
          currency: p.currency,
          dueDate: p.dueDate,
          trainerName: trainerName(p.trainerId),
        };
      });

    // --- Rutina asignada actualmente ---
    const user = await userSchema.findById(clientId).select("tableInUse");
    let assignedRoutine = null;
    if (user?.tableInUse) {
      const table = await Table.findById(user.tableInUse).select("name assignedByTrainerId");
      if (table?.assignedByTrainerId && activeTrainerIdSet.has(String(table.assignedByTrainerId))) {
        // Table no tiene createdAt/updatedAt: asignar SIEMPRE crea una copia
        // nueva (ver table-service.js#assignTemplateToClient/assignNewRoutineToClient),
        // así que el timestamp del ObjectId es una fecha de asignación fiable.
        const assignedAt = table._id.getTimestamp();
        touchActivity(table.assignedByTrainerId, assignedAt);
        assignedRoutine = {
          tableId: table._id,
          name: table.name,
          assignedByTrainerName: trainerName(table.assignedByTrainerId),
          assignedAt,
        };
      }
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
      assignedRoutine,
    });
  },

};
