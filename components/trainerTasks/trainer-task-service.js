const trainerTaskDao = require("./trainer-task-dao");
const userDao = require("../users/user-dao");
const notificationService = require("../notifications/notification-service");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { taskLabel } = require("./task-label");
const { badRequest, forbidden, notFound } = require("../util/http-error");

// Hábitos que el profesional pauta a su cliente (trainer-task-schema.js) y
// sus marcas de cumplimiento por día.

module.exports = {
  // Crea el hábito y avisa al cliente.
  async create(trainerId, clientId, data) {
    const task = await trainerTaskDao.create(trainerId, clientId, data);
    await notificationService.create(clientId, trainerId, "task_assigned", {
      taskLabel: taskLabel(task),
      target: data.target,
      unit: data.unit,
    });
    return task;
  },

  listForClient: (trainerId, clientId) => trainerTaskDao.listForClient(trainerId, clientId),
  deactivate: (trainerId, clientId, taskId) => trainerTaskDao.deactivate(trainerId, clientId, taskId),

  /**
   * Hábitos activos del cliente de cualquier profesional con relación activa
   * (de uno ya desvinculado no), con quién se lo pautó y si lo cumplió en
   * `date`.
   */
  async listActiveForClient(clientId, date) {
    const tasks = await trainerTaskDao.listActiveForClient(clientId);
    const activeTrainerIds = new Set();
    for (const trainerId of new Set(tasks.map((task) => String(task.trainerId)))) {
      if (await trainerClientService.hasActiveClient(trainerId, clientId)) activeTrainerIds.add(trainerId);
    }
    const visible = tasks.filter((task) => activeTrainerIds.has(String(task.trainerId)));

    const trainers = await userDao.listFields([...activeTrainerIds], "name lastname");
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));
    const completions = await trainerTaskDao.listCompletionsForTasks(visible.map((task) => task._id), date);
    const completedTaskIds = new Set(completions.map((c) => String(c.taskId)));

    return visible.map((task) => {
      const trainer = trainersById.get(String(task.trainerId));
      return {
        _id: task._id,
        trainerId: task.trainerId,
        trainerName: trainer ? `${trainer.name} ${trainer.lastname}`.trim() : "Tu profesional",
        type: task.type,
        label: taskLabel(task),
        target: task.target,
        targetMax: task.targetMax ?? null,
        unit: task.unit,
        date,
        completedToday: completedTaskIds.has(String(task._id)),
      };
    });
  },

  // El cliente marca (o desmarca) un hábito suyo un día. Nunca el futuro: un
  // hábito no se cumple por adelantado.
  async setCompletion(clientId, taskId, { date, today, completed }) {
    const task = await trainerTaskDao.findById(taskId);
    if (!task || String(task.clientId) !== String(clientId)) throw notFound("Tarea no encontrada");
    if (!(await trainerClientService.hasActiveClient(task.trainerId, clientId))) {
      throw forbidden("No tienes una relación activa con este profesional");
    }
    if (date > today) throw badRequest("Todavía no puedes marcar un día que no ha llegado");
    await trainerTaskDao.setCompletion(task._id, date, completed);
    return { taskId: task._id, date, completed };
  },
};
