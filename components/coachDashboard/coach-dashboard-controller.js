const trainerClientService = require("../trainerClients/trainer-client-service");
const checkinDao = require("../trainerCheckins/checkin-dao");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const nutritionPreferencesDao = require("../nutritionPreferences/nutrition-preferences-dao");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const userSchema = require("../users/schema");
const Table = require("../tables/table-schema");
const NutritionalGoal = require("../nutritionalGoals/nutritional-goal-schema");

// Tab Coach, Fase 2 — cuántos días sin respuesta hacen que un check-in se
// considere "pendiente" para cada cadencia (ver TrainerCheckinTemplate.cadence).
const CHECKIN_DUE_DAYS = { weekly: 7, biweekly: 14 };

function isCheckinDue(config, responses) {
  const lastResponse = responses[0]; // listResponses ya ordena desc por respondedAt
  // "once": pendiente únicamente si nunca se ha respondido — a diferencia de
  // weekly/biweekly, una vez respondida no vuelve a estar pendiente.
  if (config.cadence === "once") return !lastResponse;
  const cadenceDays = CHECKIN_DUE_DAYS[config.cadence] || 7;
  if (!lastResponse) return true;
  const elapsedDays = (Date.now() - new Date(lastResponse.respondedAt).getTime()) / 86400000;
  return elapsedDays >= cadenceDays;
}

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
    const appliedConfigs = await checkinDao.getAppliedConfigsForClient(clientId);
    const visibleConfigs = appliedConfigs.filter((c) => activeTrainerIdSet.has(String(c.trainerId)));
    const pendingCheckins = [];
    for (const config of visibleConfigs) {
      const responses = await checkinDao.listResponses(config.trainerId, clientId);
      touchActivity(config.trainerId, config.updatedAt);
      if (isCheckinDue(config, responses)) {
        pendingCheckins.push({ trainerId: config.trainerId, trainerName: trainerName(config.trainerId) });
      }
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
        pending: !preferences.respondedAt,
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

    // --- Rutina / objetivo asignados actualmente ---
    const user = await userSchema.findById(clientId).select("tableInUse goalInUse");
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

    let assignedGoal = null;
    if (user?.goalInUse) {
      const goal = await NutritionalGoal.findById(user.goalInUse).select(
        "name kcalTotal proteinsGTotal carbohydratesGTotal fatGTotal assignedByTrainerId updatedAt"
      );
      if (goal?.assignedByTrainerId && activeTrainerIdSet.has(String(goal.assignedByTrainerId))) {
        touchActivity(goal.assignedByTrainerId, goal.updatedAt);
        assignedGoal = {
          goalId: goal._id,
          name: goal.name,
          kcalTotal: goal.kcalTotal,
          proteinsGTotal: goal.proteinsGTotal,
          carbohydratesGTotal: goal.carbohydratesGTotal,
          fatGTotal: goal.fatGTotal,
          assignedByTrainerName: trainerName(goal.assignedByTrainerId),
          assignedAt: goal.updatedAt,
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
      assignedGoal,
    });
  },

  // Exportada para test unitario (coach-dashboard-controller.test.js) — pura,
  // sin BD.
  isCheckinDue,
};
