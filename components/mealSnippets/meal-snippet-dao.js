const MealSnippet = require("./meal-snippet-schema");

module.exports = {
  async create(trainerId, name, customProducts, customRecipes) {
    return MealSnippet.create({
      trainerId,
      name,
      customProducts: customProducts || [],
      customRecipes: customRecipes || [],
    });
  },

  async listByTrainer(trainerId) {
    return MealSnippet.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return MealSnippet.findOne({ _id: id, trainerId });
  },

  // TASK-047 (MASTER_BACKLOG.md) — renombrar un snippet ya guardado. Solo
  // `name`: re-componer el contenido (customProducts/customRecipes) exige
  // el mismo composer que ya usa la creación (compose-meal.page.ts,
  // diet-template-builder.page.ts) — fuera de alcance aquí, ver TASK-081.
  async rename(trainerId, id, name) {
    return MealSnippet.findOneAndUpdate(
      { _id: id, trainerId },
      { $set: { name } },
      { new: true }
    );
  },

  async delete(trainerId, id) {
    return MealSnippet.deleteOne({ _id: id, trainerId });
  },
};
