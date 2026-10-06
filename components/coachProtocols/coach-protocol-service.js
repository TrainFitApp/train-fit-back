const coachProtocolDao = require("./coach-protocol-dao");
const checkinDao = require("../trainerCheckins/checkin-dao");
const checkinScheduleDao = require("../trainerCheckins/checkin-schedule-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { notFound, onDuplicate } = require("../util/http-error");
const { scheduleContent, hasQuestions } = require("../trainerCheckins/checkin-schedule-content");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { protocolCheckins } = require("./protocol-content");
const { todayForUser } = require("../users/user-time-zone");
const dietPhaseService = require("../dietPhases/diet-phase-service");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const tableService = require("../tables/table-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const coachRuleDao = require("../coachRules/coach-rule-dao");
const planChangeService = require("../planChanges/plan-change-service");

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
      await checkinScheduleDao.upsertFromTemplate(trainerId, clientId, definition._id, { ...content, ...timing, active: true });
      return true;
    });
  }

  await step("dietPlan", "Plan de nutrición", async () => {
    if (!protocol.dietTemplateId) return "skipped";
    const template = await dietTemplateDao.findOwnedByTrainer(trainerId, protocol.dietTemplateId);
    if (!template) return "skipped";

    await dietPhaseService.createPhase({
      trainerId,
      clientId,
      templateId: template._id,
      startDate: startDate || today,
      reason: reason || `Aplicado el protocolo "${protocol.name}"`,
    });
    return true;
  });

  // Después del plan de dieta: el objetivo del protocolo es el que queda.
  await step("nutritionTarget", "Objetivo de kcal y macros", async () => {
    const target = protocol.nutritionTarget;
    if (!target) return "skipped";
    // Mismo permiso que editar el objetivo en la ficha: llevar la nutrición.
    if (!(await trainerClientDao.isActivePair(trainerId, clientId, "nutrition"))) throw new Error("No llevas la nutrición de este cliente");
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

const duplicateName = onDuplicate("Ya tienes un protocolo con ese nombre");
const protocolNotFound = () => notFound("Protocolo no encontrado");

// Cada cliente se comprueba y se aplica por separado: un fallo en uno nunca
// aborta el resto, y la respuesta dice paso a paso qué se aplicó a quién.
async function applyToClients(trainerId, protocolId, clientIds, { startDate, reason }) {
  const protocol = await coachProtocolDao.findOwned(trainerId, protocolId);
  if (!protocol) throw protocolNotFound();

  const results = [];
  for (const clientId of clientIds) {
    const block = await trainerClientService.clientWriteBlock(trainerId, clientId);
    if (block === "no_relation") {
      results.push({ clientId, success: false, error: "Sin relación activa con este cliente" });
      continue;
    }
    if (block === "read_only") {
      results.push({ clientId, success: false, error: "Cliente en solo lectura por el cupo de tu plan" });
      continue;
    }
    const applied = await applyToClient(trainerId, protocol, clientId, { startDate, reason }).catch((error) => ({ error }));
    results.push(
      applied.error
        ? { clientId, success: false, error: applied.error.message }
        : { clientId, success: true, steps: applied.steps },
    );
  }
  return results;
}

module.exports = {
  applyToClient,
  applyToClients,
  create: (trainerId, data) => coachProtocolDao.create(trainerId, data).catch(duplicateName),
  listForTrainer: (trainerId) => coachProtocolDao.listForTrainer(trainerId),
  findOwned: (trainerId, id) => coachProtocolDao.findOwned(trainerId, id),
  async update(trainerId, id, updates) {
    const protocol = await coachProtocolDao.update(trainerId, id, updates).catch(duplicateName);
    if (!protocol) throw protocolNotFound();
    return protocol;
  },
  async remove(trainerId, id) {
    if (!(await coachProtocolDao.remove(trainerId, id))) throw protocolNotFound();
  },
};
