const ClientNutritionPreferences = require("./nutrition-preferences-schema");

module.exports = {
  async getByClientId(clientId) {
    return ClientNutritionPreferences.findOne({ clientId }).lean();
  },

  async upsertOwnResponse(
    clientId,
    { allergies, favoriteFoods, dislikedFoods, cooksAtHome, disabledMealSlots, mealSlotLabels }
  ) {
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      {
        $set: {
          allergies: allergies || "",
          favoriteFoods: favoriteFoods || "",
          dislikedFoods: dislikedFoods || "",
          cooksAtHome: cooksAtHome || null,
          disabledMealSlots: disabledMealSlots || [],
          mealSlotLabels: mealSlotLabels || {},
          respondedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    ).lean();
  },

  async markRequested(clientId, trainerId) {
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      {
        $set: { requestedAt: new Date(), requestedBy: trainerId, updatedAt: new Date() },
        $setOnInsert: { clientId },
      },
      { new: true, upsert: true }
    ).lean();
  },
};
