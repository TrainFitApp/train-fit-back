const MealSnippet = require("./meal-snippet-schema");
const mealDao = require("../meals/meal-dao");

// Comidas guardadas del entrenador, en su propia colección y con el
// contenido embebido (2026-10; antes un Meal con trainerId).

module.exports = {
  // Se crea vacío y se le pega el contenido con el mismo pasteMeal que el
  // resto de altas de comida: alimentos y recetas quedan igual que en un
  // diario (sin marca de pautado: es material de biblioteca).
  async create(trainerId, name, customProducts, customRecipes) {
    const snippet = await MealSnippet.create({ trainerId, name });
    return mealDao.pasteMeal(
      { customProducts: customProducts || [], customRecipes: customRecipes || [] },
      snippet,
      false,
    );
  },

  async listByTrainer(trainerId) {
    return MealSnippet.find({ trainerId }).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return MealSnippet.findOne({ _id: id, trainerId });
  },

  async rename(trainerId, id, name) {
    return MealSnippet.findOneAndUpdate({ _id: id, trainerId }, { $set: { name }, $inc: { __v: 1 } }, { new: true });
  },

  async delete(trainerId, id) {
    return MealSnippet.deleteOne({ _id: id, trainerId });
  },
};
