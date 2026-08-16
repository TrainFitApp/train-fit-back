const ClientNutritionPreferences = require("./nutrition-preferences-schema");

module.exports = {
  async findByClientId(clientId) {
    return ClientNutritionPreferences.findOne({ clientId }).lean();
  },

  async upsertSharedFields(clientId, fields) {
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      { $set: fields },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async upsertByClient(clientId, fields) {
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      { $set: fields, $unset: { requestedAt: "", requestedBy: "" }, $currentDate: { respondedAt: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async markRequested(clientId, trainerId) {
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      { $set: { requestedAt: new Date(), requestedBy: trainerId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },
};
