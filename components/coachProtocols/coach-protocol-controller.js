const coachProtocolService = require("./coach-protocol-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

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
    checkinTemplateId: body.checkinTemplateId || null,
    dietTemplateId: body.dietTemplateId || null,
    routineTemplateId: body.routineTemplateId || null,
    ruleIds: body.ruleIds || [],
    dailyTasks: body.dailyTasks || [],
  };
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
    const taskError = validateDailyTasks(body.dailyTasks);
    if (taskError) return res.status(400).send({ message: taskError });

    try {
      const protocol = await coachProtocolService.create(req.auth.userId, buildPayload(body));
      return res.status(201).send(protocol);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes un protocolo con ese nombre" });
      }
      throw e;
    }
  },

  async update(req, res) {
    const taskError = validateDailyTasks(req.body?.dailyTasks);
    if (taskError) return res.status(400).send({ message: taskError });

    try {
      const protocol = await coachProtocolService.update(
        req.auth.userId,
        req.params.id,
        buildPayload(req.body || {})
      );
      if (!protocol) return res.status(404).send({ message: "Protocolo no encontrado" });
      return res.send(protocol);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes un protocolo con ese nombre" });
      }
      throw e;
    }
  },

  async remove(req, res) {
    const protocol = await coachProtocolService.remove(req.auth.userId, req.params.id);
    if (!protocol) return res.status(404).send({ message: "Protocolo no encontrado" });
    return res.sendStatus(204);
  },

  // POST /trainer/protocols/:id/apply — body: { clientIds, startDate?, reason? }
  //
  // Cada cliente se valida por separado y se aplica de forma independiente:
  // un fallo en uno nunca aborta el resto, y la respuesta dice paso a paso
  // qué se aplicó a quién. Mismo criterio que las rutas de "aplicar en
  // bloque" que ya existen (trainer-client-data-controller.js#applyToTargets).
  async applyToClients(req, res) {
    const trainerId = req.auth.userId;
    const { clientIds, startDate, reason } = req.body || {};

    if (!Array.isArray(clientIds) || !clientIds.length) {
      return res.status(400).send({ message: "Elige al menos un cliente" });
    }

    const protocol = await coachProtocolService.findOwned(trainerId, req.params.id);
    if (!protocol) return res.status(404).send({ message: "Protocolo no encontrado" });

    const results = [];
    for (const clientId of clientIds) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId);
      if (!relation) {
        results.push({ clientId, success: false, error: "Sin relación activa con este cliente" });
        continue;
      }
      try {
        const applied = await coachProtocolService.applyToClient(trainerId, protocol, clientId, {
          startDate,
          reason,
        });
        results.push({ clientId, success: true, steps: applied.steps });
      } catch (error) {
        results.push({ clientId, success: false, error: error.message });
      }
    }

    return res.send(results);
  },
};
