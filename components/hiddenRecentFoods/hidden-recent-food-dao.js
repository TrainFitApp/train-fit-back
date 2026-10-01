const HiddenRecentFood = require("./hidden-recent-food-schema");

module.exports = {
  listForMeal(userId, mealIndex, kind) {
    return HiddenRecentFood.find({ userId, mealIndex, kind }).select("refId hiddenAt").lean();
  },

  async hideItems(userId, mealIndex, kind, refIds, hiddenAt) {
    await HiddenRecentFood.bulkWrite(
      refIds.map((refId) => ({
        updateOne: {
          filter: { userId, mealIndex, kind, refId },
          update: { $set: { hiddenAt } },
          upsert: true,
        },
      }))
    );
  },

  // Los ocultos sueltos quedan cubiertos por el corte general: se borran para
  // que la colección no crezca con entradas que ya no aportan nada.
  async hideAll(userId, mealIndex, kind, hiddenAt) {
    await HiddenRecentFood.deleteMany({ userId, mealIndex, kind, refId: { $ne: null } });
    await HiddenRecentFood.updateOne(
      { userId, mealIndex, kind, refId: null },
      { $set: { hiddenAt } },
      { upsert: true }
    );
  },

  async restoreItems(userId, mealIndex, kind, refIds) {
    await HiddenRecentFood.deleteMany({ userId, mealIndex, kind, refId: { $in: refIds } });
  },
};
