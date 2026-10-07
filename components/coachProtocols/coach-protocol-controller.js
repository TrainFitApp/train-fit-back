const coachProtocolService = require("./coach-protocol-service");
const {
  normalizeCheckins,
  validateCheckins,
  normalizeNutritionTarget,
  validateNutritionTarget,
} = require("./protocol-content");
const { validDate } = require("../trainerCheckins/checkin-schedule-dates");

const TASK_TYPES = ["steps", "water", "sleep", "cardio", "custom"];

function validateDailyTasks(tasks) {
  for (const task of tasks || []) {
    if (!TASK_TYPES.includes(task.type)) return `Tipo de tarea no válido: ${task.type}`;
    if (task.type === "custom" && !task.label?.trim()) {
      return "Las tareas personalizadas necesitan un nombre";
    }
    if (!(Number(task.target) > 0)) return "Cada tarea necesita un objetivo mayor que 0";
    if (!task.unit?.trim()) return "Cada tarea necesita una unidad";
  }
  return null;
}

function buildPayload(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    checkins: normalizeCheckins(body.checkins),
    dietTemplateId: body.dietTemplateId || null,
    routineTemplateId: body.routineTemplateId || null,
    ruleIds: body.ruleIds || [],
    dailyTasks: body.dailyTasks || [],
    nutritionTarget: normalizeNutritionTarget(body.nutritionTarget),
  };
}

function payloadError(body, payload) {
  return (
    validateDailyTasks(body.dailyTasks) ||
    validateCheckins(payload.checkins) ||
    validateNutritionTarget(payload.nutritionTarget)
  );
}

module.exports = {
  async listMine(req, res) {
    const protocols = await coachProtocolService.listForTrainer(req.auth.userId);
    return res.send(protocols);
  },

  async create(req, res) {
    const body = req.body || {};
    if (!body.name?.trim()) {
      return res.status(400).send({ message: "El protocolo necesita un nombre" });
    }
    const payload = buildPayload(body);
    const error = payloadError(body, payload);
    if (error) return res.status(400).send({ message: error });

    return res.status(201).send(await coachProtocolService.create(req.auth.userId, payload));
  },

  async update(req, res) {
    const body = req.body || {};
    if (!body.name?.trim()) {
      return res.status(400).send({ message: "El protocolo necesita un nombre" });
    }
    const payload = buildPayload(body);
    const error = payloadError(body, payload);
    if (error) return res.status(400).send({ message: error });

    return res.send(await coachProtocolService.update(req.auth.userId, req.params.id, payload));
  },

  async remove(req, res) {
    await coachProtocolService.remove(req.auth.userId, req.params.id);
    return res.sendStatus(204);
  },

  // POST /trainer/protocols/:id/apply — body: { clientIds, startDate?, reason? }
  //
  // Uno a uno: un fallo en un cliente no aborta el resto
  // (coach-protocol-service.js#applyToClients).
  async applyToClients(req, res) {
    const trainerId = req.auth.userId;
    const { clientIds, startDate, reason } = req.body || {};

    if (!Array.isArray(clientIds) || !clientIds.length) {
      return res.status(400).send({ message: "Elige al menos un cliente" });
    }
    if (startDate !== undefined && startDate !== null && !validDate(startDate)) {
      return res.status(400).send({ message: "Fecha de inicio no válida (YYYY-MM-DD)" });
    }

    return res.send(await coachProtocolService.applyToClients(trainerId, req.params.id, clientIds, { startDate, reason }));
  },
};
