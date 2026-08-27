const CoachProtocol = require("./coach-protocol-schema");
const checkinDao = require("../trainerCheckins/checkin-dao");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const tableService = require("../tables/table-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const coachRuleDao = require("../coachRules/coach-rule-dao");
const planChangeService = require("../planChanges/plan-change-service");
const notificationDao = require("../notifications/notification-dao");
const userSchema = require("../users/schema");

// Fase 4 Coach Pro — aplicar un protocolo a un cliente.
//
// Cada paso llama a la MISMA operación que el coach ejecutaría a mano. No
// hay una vía rápida propia que escriba en las colecciones directamente:
// eso crearía dos formas de asignar una rutina que acabarían divergiendo
// (una aprendería a notificar al cliente, la otra no; una respetaría un
// límite nuevo, la otra no).
//
// Cada paso es independiente: si el plan de dieta falla, el objetivo y el
// check-in que ya se aplicaron se conservan y el resultado lo dice paso a
// paso. Abortar entero dejaría al coach sin saber qué quedó a medias, y
// deshacer lo ya aplicado exigiría transacciones que este proyecto no usa
// en ningún otro sitio.

async function applyToClient(trainerId, protocol, clientId, { startDate, reason } = {}) {
  const steps = [];
  const step = async (key, label, fn) => {
    try {
      const skipped = await fn();
      steps.push({ key, label, status: skipped === "skipped" ? "skipped" : "applied" });
    } catch (error) {
      steps.push({ key, label, status: "failed", error: error.message });
    }
  };

  await step("nutritionalGoal", "Objetivo nutricional", async () => {
    const macros = protocol.nutritionalGoal || {};
    if (macros.kcalTotal === null || macros.kcalTotal === undefined) return "skipped";

    const client = await userSchema.findById(clientId).select("goalInUse").lean();
    const previousGoal = client?.goalInUse
      ? await nutritionalGoalService.getById(client.goalInUse)
      : null;

    const goal = await nutritionalGoalService.create({
      userId: clientId,
      assignedByTrainerId: trainerId,
      name: protocol.name,
      kcalTotal: macros.kcalTotal || 0,
      proteinsGTotal: macros.proteinsGTotal || 0,
      carbohydratesGTotal: macros.carbohydratesGTotal || 0,
      fatGTotal: macros.fatGTotal || 0,
    });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    await notificationDao.create(clientId, trainerId, "goal_assigned", {
      goalName: goal.name,
      kcalTotal: goal.kcalTotal,
    });
    await planChangeService.recordGoalChange({
      trainerId,
      clientId,
      previousGoal,
      newGoal: goal,
      action: previousGoal ? "replaced" : "assigned",
      reason: reason || `Aplicado el protocolo "${protocol.name}"`,
    });
    return true;
  });

  await step("checkin", "Plantilla de check-in", async () => {
    if (!protocol.checkinTemplateId) return "skipped";
    const definition = await checkinDao.getDefinitionById(trainerId, protocol.checkinTemplateId);
    if (!definition) return "skipped";
    await checkinDao.applyToClient(trainerId, clientId, definition);
    await notificationDao.create(clientId, trainerId, "checkin_requested", {
      templateName: definition.name,
    });
    return true;
  });

  await step("dietPlan", "Plan de nutrición", async () => {
    if (!protocol.dietTemplateId) return "skipped";
    const plan = await dietTemplateDao.findOwnedByTrainer(trainerId, protocol.dietTemplateId);
    if (!plan) return "skipped";

    const previousAssignment = await planAssignmentService.getActiveForClient(clientId);
    const assignment = await planAssignmentService.applyPlan({
      trainerId,
      clientId,
      planId: protocol.dietTemplateId,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endMode: "indefinite",
    });
    await planChangeService.recordPlanAssignment({
      trainerId,
      clientId,
      previousAssignment,
      newAssignment: assignment,
      planName: plan.name,
      reason: reason || `Aplicado el protocolo "${protocol.name}"`,
    });
    return true;
  });

  await step("routine", "Rutina", async () => {
    if (!protocol.routineTemplateId) return "skipped";
    // Misma operación que "asignar plantilla de rutina" desde la ficha.
    await tableService.assignTemplateToClient(clientId, protocol.routineTemplateId, trainerId);
    return true;
  });

  await step("dailyTasks", "Tareas diarias", async () => {
    if (!protocol.dailyTasks?.length) return "skipped";
    for (const task of protocol.dailyTasks) {
      await trainerTaskDao.create(trainerId, clientId, {
        type: task.type,
        label: task.label,
        target: task.target,
        unit: task.unit,
      });
    }
    return true;
  });

  await step("rules", "Automatizaciones", async () => {
    if (!protocol.ruleIds?.length) return "skipped";
    for (const ruleId of protocol.ruleIds) {
      const rule = await coachRuleDao.findOwned(trainerId, ruleId);
      // Una regla que ya aplica a TODOS los clientes no necesita que se le
      // añada este: añadirlo la convertiría en "solo algunos" por error.
      if (!rule || rule.appliesTo !== "selected") continue;
      const clientIds = (rule.clientIds || []).map(String);
      if (clientIds.includes(String(clientId))) continue;
      await coachRuleDao.update(trainerId, ruleId, {
        clientIds: [...clientIds, clientId],
      });
    }
    return true;
  });

  await planChangeService.record({
    trainerId,
    clientId,
    entity: "protocol",
    entityId: protocol._id,
    entityName: protocol.name,
    action: "assigned",
    changes: steps
      .filter((s) => s.status === "applied")
      .map((s) => ({ field: s.key, label: s.label, previousValue: null, newValue: "aplicado" })),
    reason: reason || `Aplicado el protocolo "${protocol.name}"`,
  });

  return { steps };
}

module.exports = {
  applyToClient,
  async create(trainerId, data) {
    return CoachProtocol.create({ trainerId, ...data });
  },
  async listForTrainer(trainerId) {
    return CoachProtocol.find({ trainerId }).sort({ name: 1 }).lean();
  },
  async findOwned(trainerId, id) {
    return CoachProtocol.findOne({ _id: id, trainerId }).lean();
  },
  async update(trainerId, id, updates) {
    return CoachProtocol.findOneAndUpdate(
      { _id: id, trainerId },
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
  },
  async remove(trainerId, id) {
    return CoachProtocol.findOneAndDelete({ _id: id, trainerId });
  },
};
