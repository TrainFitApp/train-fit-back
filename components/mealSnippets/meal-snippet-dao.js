const mealSchema = require("../meals/meal-schema");
const mealDao = require("../meals/meal-dao");

module.exports = {
  // Crea el Meal-snippet vacío y materializa su contenido con el mismo
  // pasteMeal que usa cualquier paste real (clona customProducts/
  // customRecipes de verdad, con _id propio) — no reinventa esa traducción
  // aquí, mismo criterio que applyToSplit en workoutTemplates.
  async create(trainerId, name, customProducts, customRecipes) {
    const meal = await mealSchema.create({ trainerId, name });
    return mealDao.pasteMeal(
      { customProducts: customProducts || [], customRecipes: customRecipes || [] },
      meal,
      false
    );
  },

  async listByTrainer(trainerId) {
    return mealSchema.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return mealSchema.findOne({ _id: id, trainerId });
  },

  // TASK-047 (MASTER_BACKLOG.md) — renombrar un snippet ya guardado. Solo
  // `name`: re-componer el contenido (customProducts/customRecipes) exige
  // el mismo composer que ya usa la creación (compose-meal.page.ts,
  // diet-template-builder.page.ts) — fuera de alcance aquí, ver TASK-081.
  async rename(trainerId, id, name) {
    return mealSchema.findOneAndUpdate(
      { _id: id, trainerId },
      { $set: { name } },
      { new: true }
    );
  },

  // deleteOne (no deleteMany) dispara el hook en cascada de meal-schema.js
  // que borra los CustomProduct/CustomRecipe del snippet.
  async delete(trainerId, id) {
    return mealSchema.deleteOne({ _id: id, trainerId });
  },
};
