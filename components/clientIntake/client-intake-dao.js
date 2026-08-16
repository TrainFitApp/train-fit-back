const ClientIntake = require("./client-intake-schema");

module.exports = {
  async upsert(trainerId, clientId, data) {
    return ClientIntake.findOneAndUpdate(
      { trainerId, clientId },
      { $set: { ...data, submittedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  },

  async findByTrainerAndClient(trainerId, clientId) {
    return ClientIntake.findOne({ trainerId, clientId }).lean();
  },
};
