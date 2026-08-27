const TrainerTask = require("./trainer-task-schema");
const TaskCompletion = require("./task-completion-schema");

module.exports = {
  async create(trainerId, clientId, { type, label, target, unit }) {
    return TrainerTask.create({ trainerId, clientId, type, label: label || null, target, unit });
  },

  async listForClient(trainerId, clientId) {
    return TrainerTask.find({ trainerId, clientId, active: true }).sort({ createdAt: 1 }).lean();
  },

  async findById(taskId) {
    return TrainerTask.findById(taskId);
  },

  async deactivate(trainerId, clientId, taskId) {
    return TrainerTask.findOneAndUpdate(
      { _id: taskId, trainerId, clientId },
      { $set: { active: false } },
      { new: true }
    );
  },

  // Tareas activas del cliente, de CUALQUIER profesional (el controller
  // filtra por relación activa) — usado por el listado "mis tareas de hoy".
  async listActiveForClient(clientId) {
    return TrainerTask.find({ clientId, active: true }).lean();
  },

  // Movimiento 1 Coach Pro — lo mismo que listForClient pero para TODA la
  // cartera de un profesional en una consulta. La vista de Cartera calcula
  // la adherencia de 30 clientes de golpe: una consulta por cliente aquí
  // sería el fan-out que el evaluador nocturno lleva evitando desde la
  // Fase 1 (ver coach-alert-service.js#loadTrainerContext).
  async listForClients(trainerId, clientIds) {
    if (!clientIds?.length) return [];
    // La Cartera desglosa la adherencia de hábitos uno a uno: necesita la
    // etiqueta, el objetivo y sobre todo `createdAt`, que es contra lo que
    // se miden los días activos de cada hábito.
    return TrainerTask.find({ trainerId, clientId: { $in: clientIds }, active: true })
      .select("clientId type label target unit createdAt")
      .lean();
  },

  async setCompletion(taskId, date, completed) {
    if (completed) {
      return TaskCompletion.findOneAndUpdate(
        { taskId, date },
        { $set: { completed: true, completedAt: new Date() } },
        { new: true, upsert: true }
      );
    }
    await TaskCompletion.deleteOne({ taskId, date });
    return null;
  },

  async listCompletionsForTasks(taskIds, date) {
    return TaskCompletion.find({ taskId: { $in: taskIds }, date }).lean();
  },

  // Fase 2 Coach Pro — cumplimientos de un RANGO de fechas (no de un día
  // suelto como listCompletionsForTasks), para la dimensión "hábitos" de la
  // adherencia multidimensional. `date` es "YYYY-MM-DD" y se compara como
  // string: el orden lexicográfico de ese formato coincide con el
  // cronológico, así que $gte/$lte funcionan sin parsear fechas. Mismo
  // criterio que ya usa getFullyPopulatedDietDaysForDiet.
  async listCompletionsForTasksInRange(taskIds, fromDate, toDate) {
    if (!taskIds?.length) return [];
    return TaskCompletion.find({
      taskId: { $in: taskIds },
      date: { $gte: fromDate, $lte: toDate },
      completed: true,
    })
      .select("taskId date")
      .lean();
  },
};
