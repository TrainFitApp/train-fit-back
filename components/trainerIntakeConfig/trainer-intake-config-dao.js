const TrainerIntakeConfig = require("./trainer-intake-config-schema");

module.exports = {
  async findByTrainerId(trainerId) {
    return TrainerIntakeConfig.findOne({ trainerId }).lean();
  },

  async upsert(trainerId, enabledFields) {
    return TrainerIntakeConfig.findOneAndUpdate(
      { trainerId },
      { $set: { enabledFields } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },
};
