const DietTemplate = require("./diet-template-schema");

module.exports = {
  async create(trainerId, name, days) {
    return DietTemplate.create({ trainerId, name, days: days || [] });
  },

  async listByTrainer(trainerId) {
    return DietTemplate.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, { name, days }) {
    const update = {};
    if (name !== undefined) update.name = name;
    if (days !== undefined) update.days = days;
    return DietTemplate.findOneAndUpdate({ _id: id, trainerId }, update, { new: true });
  },

  async delete(trainerId, id) {
    return DietTemplate.deleteOne({ _id: id, trainerId });
  },
};
