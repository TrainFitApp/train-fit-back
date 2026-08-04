const ClientIntake = require("./client-intake-schema");

module.exports = {
  async upsert(trainerId, clientId, { goals, healthConditions, experienceLevel, availability, equipment }) {
    return ClientIntake.findOneAndUpdate(
      { trainerId, clientId },
      {
        $set: {
          goals: goals || "",
          healthConditions: healthConditions || "",
          experienceLevel: experienceLevel || null,
          availability: availability || "",
          equipment: equipment || "",
          submittedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    ).lean();
  },

  async getByTrainerAndClient(trainerId, clientId) {
    return ClientIntake.findOne({ trainerId, clientId }).lean();
  },
};
