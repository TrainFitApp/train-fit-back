const ClientNutritionPreferences = require("./nutrition-preferences-schema");

module.exports = {
  async getByClientId(clientId) {
    return ClientNutritionPreferences.findOne({ clientId }).lean();
  },

  async upsertOwnResponse(
    clientId,
    {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      dietaryFlags,
      disabledMealSlots,
      mealSlotLabels,
    }
  ) {
    const set = {
      allergies: allergies || "",
      favoriteFoods: favoriteFoods || "",
      dislikedFoods: dislikedFoods || "",
      cooksAtHome: cooksAtHome || null,
      disabledMealSlots: disabledMealSlots || [],
      mealSlotLabels: mealSlotLabels || {},
      respondedAt: new Date(),
      updatedAt: new Date(),
    };
    // Solo se pisa si viene en la petición — el editor de preferencias del
    // cliente no siempre manda dietaryFlags (los pauta el intake).
    if (Array.isArray(dietaryFlags)) {
      set.dietaryFlags = dietaryFlags.filter((f) =>
        ["vegan", "vegetarian", "lactoseFree", "glutenFree"].includes(f)
      );
    }
    return ClientNutritionPreferences.findOneAndUpdate(
      { clientId },
      { $set: set },
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
