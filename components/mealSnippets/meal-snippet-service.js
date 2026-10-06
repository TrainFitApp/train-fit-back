const mealSnippetDao = require("./meal-snippet-dao");

// Comidas guardadas del profesional (meal-snippet-schema.js).

module.exports = {
  create: (trainerId, name, customProducts, customRecipes) => mealSnippetDao.create(trainerId, name, customProducts, customRecipes),
  listByTrainer: (trainerId) => mealSnippetDao.listByTrainer(trainerId),
  rename: (trainerId, id, name) => mealSnippetDao.rename(trainerId, id, name),
  // true si existía y era suya.
  async remove(trainerId, id) {
    return (await mealSnippetDao.delete(trainerId, id)).deletedCount > 0;
  },
};
