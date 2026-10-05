const CoachProtocol = require("./coach-protocol-schema");
const checkinDao = require("../trainerCheckins/checkin-dao");
const CheckinSchedule = require("../trainerCheckins/checkin-schedule-schema");
const { scheduleContent, hasQuestions } = require("../trainerCheckins/checkin-agenda-controller");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { protocolCheckins } = require("./protocol-content");
const { todayForUser } = require("../users/user-time-zone");
const planAssignmentService = require("../planAssignments/plan-assignment-service");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const tableService = require("../tables/table-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const coachRuleDao = require("../coachRules/coach-rule-dao");
const planChangeService = require("../planChanges/plan-change-service");
const notificationDao = require("../notifications/notification-dao");

// Fase 4 Coach Pro — aplicar un protocolo a un cliente.
//
// Cada paso llama a la MISMA operación que el coach ejecutaría a mano. No
// hay una vía rápida propia que escriba en las colecciones directamente:
// eso crearía dos formas de asignar una rutina que acabarían divergiendo
// (una aprendería a notificar al cliente, la otra no; una respetaría un
// límite nuevo, la otra no).
//
// Cada paso es independiente: si el plan de dieta falla, el check-in que
// ya se aplicó se conserva y el resultado lo dice paso a
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

  // Sin fecha, desde hoy en la zona del cliente.
  const today = await todayForUser(clientId);
  const checkins = protocolCheckins(protocol);
  if (!checkins.length) {
    steps.push({ key: "checkin", label: "Check-ins", status: "skipped" });
  }
  // Un paso por check-in: cada uno se programa (o falla) por su cuenta.
  for (const [index, checkin] of checkins.entries()) {
    const definition = await checkinDao.getDefinitionById(trainerId, checkin.templateId).catch(() => null);
    await step(`checkin:${index}`, `Check-in "${definition?.name || "plantilla eliminada"}"`, async () => {
      if (!definition) return "skipped";
      const content = scheduleContent(definition);
      if (!hasQuestions(content)) return "skipped";
      // Empieza el día de aplicar (o el elegido), con la cadencia del
      // protocolo. El entrenador la afina luego en la ficha del cliente.
      const timing = {
        startDate: startDate || today,
        time: checkin.time || "09:00",
        frequency: checkin.frequency || "weekly",
        interval: checkin.interval || 1,
      };
      await CheckinSchedule.findOneAndUpdate(
        { trainerId, clientId, sourceTemplateId: definition._id },
        { $set: { ...content, ...timing, active: true }, $inc: { revision: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return true;
    });
  }

  await step("dietPlan", "Plan de nutrición", async () => {
    if (!protocol.dietTemplateId) return "skipped";
    const plan = await dietTemplateDao.findOwnedByTrainer(trainerId, protocol.dietTemplateId);
    if (!plan) return "skipped";

    const previousAssignment = await planAssignmentService.getActiveForClient(clientId);
    const assignment = await planAssignmentService.applyPlan({
      trainerId,
      clientId,
      template: plan,
      startDate: startDate || today,
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

  // Después del plan de dieta: el objetivo del protocolo es el que queda.
  await step("nutritionTarget", "Objetivo de kcal y macros", async () => {
    const target = protocol.nutritionTarget;
    if (!target) return "skipped";
    // Mismo permiso que editar el objetivo en la ficha: llevar la nutrición.
    const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId, "nutrition");
    if (!relation) throw new Error("No llevas la nutrición de este cliente");
    await nutritionalGoalService.setManualGoalForClient(trainerId, clientId, {
      kcalTotal: target.kcal,
      proteinsGTotal: target.protein,
      carbohydratesGTotal: target.carbs,
      fatGTotal: target.fat,
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
