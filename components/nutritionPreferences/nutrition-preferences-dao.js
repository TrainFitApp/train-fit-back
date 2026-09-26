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
      respondedAt: new Date(),
      updatedAt: new Date(),
    };
    // Los formularios ya no renombran comidas: si no llega, se conserva lo
    // guardado (versiones antiguas de la app aún lo mandan).
    if (mealSlotLabels != null) set.mealSlotLabels = mealSlotLabels;
    // Solo se pisa si viene en la petición: versiones antiguas de la app
    // del cliente no mandan dietaryFlags.
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
