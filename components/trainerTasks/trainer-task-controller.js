const trainerTaskService = require("./trainer-task-service");
const { todayIsoDate } = require("../util/date-util");
const { TASK_TYPES } = require("./task-label");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = {
  // --- Lado profesional ---

  // POST /trainer/clients/:clientId/tasks — requireActiveClient() sin scope
  async createTask(req, res) {
    const { type, label, target, targetMax, unit } = req.body || {};
    if (!TASK_TYPES.includes(type)) {
      return res.status(400).send({ message: `type debe ser uno de: ${TASK_TYPES.join(", ")}` });
    }
    if (type === "custom" && (!label || !label.trim())) {
      return res.status(400).send({ message: "label es obligatorio para type=custom" });
    }
    const numericTarget = Number(target);
    if (!numericTarget || numericTarget <= 0) {
      return res.status(400).send({ message: "target debe ser un número positivo" });
    }
    if (!unit || !unit.trim()) {
      return res.status(400).send({ message: "unit es obligatorio" });
    }
    // Rango opcional ("10.000 a 15.000 pasos"): si viene, tiene que ser un
    // tope por encima del objetivo, no otro número suelto.
    const numericTargetMax = targetMax === undefined || targetMax === null || targetMax === "" ? null : Number(targetMax);
    if (numericTargetMax !== null && (!Number.isFinite(numericTargetMax) || numericTargetMax <= numericTarget)) {
      return res.status(400).send({ message: "El tope del rango debe ser mayor que el objetivo" });
    }

    const task = await trainerTaskService.create(req.auth.userId, req.params.clientId, {
      type,
      label: type === "custom" ? label.trim() : label,
      target: numericTarget,
      targetMax: numericTargetMax,
      unit: unit.trim(),
    });
    return res.status(201).send(task);
  },

  // GET /trainer/clients/:clientId/tasks — requireActiveClient() sin scope
  async listClientTasks(req, res) {
    const tasks = await trainerTaskService.listForClient(req.auth.userId, req.params.clientId);
    return res.send(tasks);
  },

  // DELETE /trainer/clients/:clientId/tasks/:taskId — requireActiveClient() sin scope
  async deactivateTask(req, res) {
    const task = await trainerTaskService.deactivate(req.auth.userId, req.params.clientId, req.params.taskId);
    if (!task) return res.status(404).send({ message: "Tarea no encontrada" });
    return res.sendStatus(204);
  },

  // --- Lado cliente ---

  // GET /trainer/tasks/mine?date=YYYY-MM-DD — hábitos activos del cliente,
  // de cualquier profesional con relación activa, con el cumplimiento de ESE
  // día ya resuelto. La pantalla de dieta los pinta bajo las comidas del día
  // que se esté mirando, así que el día no siempre es hoy.
  async listMine(req, res) {
    const date = ISO_DATE.test(req.query?.date || "") ? req.query.date : todayIsoDate(req.auth.timeZone);
    return res.send(await trainerTaskService.listActiveForClient(req.auth.userId, date));
  },

  // POST /trainer/tasks/:taskId/toggle — body: { completed: boolean, date? }
  // `date` para marcar un día que no es hoy (la pantalla de dieta se mira
  // día a día). Nunca el futuro: un hábito no se cumple por adelantado.
  async toggleCompletion(req, res) {
    const today = todayIsoDate(req.auth.timeZone);
    const date = ISO_DATE.test(req.body?.date || "") ? req.body.date : today;
    const result = await trainerTaskService.setCompletion(req.auth.userId, req.params.taskId, {
      date,
      today,
      completed: req.body?.completed !== false,
    });
    return res.send(result);
  },
};
