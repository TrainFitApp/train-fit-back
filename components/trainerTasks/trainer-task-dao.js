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
};
