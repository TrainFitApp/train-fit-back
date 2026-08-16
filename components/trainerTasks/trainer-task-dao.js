const TrainerTask = require("./trainer-task-schema");
const TaskCompletion = require("./task-completion-schema");

module.exports = {
  async create(data) {
    return TrainerTask.create(data);
  },

  async findById(id) {
    return TrainerTask.findById(id);
  },

  async findByTrainerClientId(trainerClientId, { includeInactive = false } = {}) {
    const query = { trainerClientId };
    if (!includeInactive) query.active = true;
    return TrainerTask.find(query).sort({ createdAt: 1 }).lean();
  },

  async update(id, updates) {
    return TrainerTask.findByIdAndUpdate(id, { $set: updates }, { new: true });
  },

  async setActive(id, active) {
    return TrainerTask.findByIdAndUpdate(id, { $set: { active } }, { new: true });
  },

  // --- TaskCompletion ---

  async upsertCompletion(taskId, date, completed) {
    return TaskCompletion.findOneAndUpdate(
      { taskId, date },
      { $set: { completed } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  },

  async findCompletionsByTaskIds(taskIds, { startDate, endDate } = {}) {
    const query = { taskId: { $in: taskIds } };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }
    return TaskCompletion.find(query).lean();
  },
};
