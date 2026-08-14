const DietTemplate = require("./diet-template-schema");

module.exports = {
  async create(trainerId, name, days, mode, dayPatterns) {
    return DietTemplate.create({
      trainerId,
      name,
      days: days || [],
      mode: mode || "sequential",
      dayPatterns: dayPatterns || [],
    });
  },

  async listByTrainer(trainerId) {
    return DietTemplate.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  // TASK-045 (MASTER_BACKLOG.md) — lookup en lote para adjuntar planName al
  // listar el historial de PlanAssignment de un cliente (varias fases,
  // posiblemente de plantillas ya editadas/borradas después).
  async findManyByIds(trainerId, ids) {
    return DietTemplate.find({ _id: { $in: ids }, trainerId }).select("name");
  },

  async update(trainerId, id, { name, days, mode, dayPatterns }) {
    const update = {};
    if (name !== undefined) update.name = name;
    if (days !== undefined) update.days = days;
    if (mode !== undefined) update.mode = mode;
    if (dayPatterns !== undefined) update.dayPatterns = dayPatterns;
    return DietTemplate.findOneAndUpdate({ _id: id, trainerId }, update, { new: true });
  },

  async delete(trainerId, id) {
    return DietTemplate.deleteOne({ _id: id, trainerId });
  },
};
