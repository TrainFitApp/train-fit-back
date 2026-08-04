const trainerTaskDao = require("./trainer-task-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const notificationDao = require("../notifications/notification-dao");
const userSchema = require("../users/schema");

const TASK_TYPES = ["steps", "water", "sleep", "cardio", "custom"];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function taskDisplayLabel(task) {
  if (task.type === "custom") return task.label || "Tarea";
  const presetLabels = { steps: "Pasos diarios", water: "Agua", sleep: "Horas de sueño", cardio: "Cardio" };
  return task.label || presetLabels[task.type] || "Tarea";
}

module.exports = {
  // --- Lado profesional ---

  // POST /trainer/clients/:clientId/tasks — requireActiveClient() sin scope
  async createTask(req, res) {
    const { type, label, target, unit } = req.body || {};
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

    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;

    const task = await trainerTaskDao.create(trainerId, clientId, {
      type,
      label: type === "custom" ? label.trim() : label,
      target: numericTarget,
      unit: unit.trim(),
    });

    await notificationDao.create(clientId, trainerId, "task_assigned", {
      taskLabel: taskDisplayLabel(task),
      target: numericTarget,
      unit: unit.trim(),
    });

    return res.status(201).send(task);
  },

  // GET /trainer/clients/:clientId/tasks — requireActiveClient() sin scope
  async listClientTasks(req, res) {
    const tasks = await trainerTaskDao.listForClient(req.auth.userId, req.params.clientId);
    return res.send(tasks);
  },

  // DELETE /trainer/clients/:clientId/tasks/:taskId — requireActiveClient() sin scope
  async deactivateTask(req, res) {
    const task = await trainerTaskDao.deactivate(req.auth.userId, req.params.clientId, req.params.taskId);
    if (!task) return res.status(404).send({ message: "Tarea no encontrada" });
    return res.sendStatus(204);
  },

  // --- Lado cliente ---

  // GET /trainer/tasks/mine — tareas activas de HOY, de cualquier profesional
  // con relación activa, con el estado de cumplimiento de hoy ya resuelto.
  async listMine(req, res) {
    const clientId = req.auth.userId;
    const tasks = await trainerTaskDao.listActiveForClient(clientId);

    const activeTrainerIds = new Set();
    for (const task of tasks) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(task.trainerId, clientId);
      if (relation) activeTrainerIds.add(String(task.trainerId));
    }
    const visible = tasks.filter((t) => activeTrainerIds.has(String(t.trainerId)));

    const trainerIds = [...new Set(visible.map((t) => String(t.trainerId)))];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    const today = todayIsoDate();
    const completions = await trainerTaskDao.listCompletionsForTasks(
      visible.map((t) => t._id),
      today
    );
    const completedTaskIds = new Set(completions.map((c) => String(c.taskId)));

    return res.send(
      visible.map((task) => ({
        _id: task._id,
        trainerId: task.trainerId,
        trainerName: trainersById.get(String(task.trainerId))
          ? `${trainersById.get(String(task.trainerId)).name} ${trainersById.get(String(task.trainerId)).lastname}`.trim()
          : "Tu profesional",
        type: task.type,
        label: taskDisplayLabel(task),
        target: task.target,
        unit: task.unit,
        completedToday: completedTaskIds.has(String(task._id)),
      }))
    );
  },

  // POST /trainer/tasks/:taskId/toggle — body: { completed: boolean }
  async toggleCompletion(req, res) {
    const clientId = req.auth.userId;
    const task = await trainerTaskDao.findById(req.params.taskId);
    if (!task || String(task.clientId) !== String(clientId)) {
      return res.status(404).send({ message: "Tarea no encontrada" });
    }

    const relation = await trainerClientDao.findActiveByTrainerAndClient(task.trainerId, clientId);
    if (!relation) {
      return res.status(403).send({ message: "No tienes una relación activa con este profesional" });
    }

    const completed = req.body?.completed !== false;
    await trainerTaskDao.setCompletion(task._id, todayIsoDate(), completed);
    return res.send({ taskId: task._id, date: todayIsoDate(), completed });
  },
};
