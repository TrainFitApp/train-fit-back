const dietModel = require("./diet-model");

// Capa de compatibilidad — ver cabecera de diet-dao.js. Solo quedan los
// endpoints que las apps instaladas siguen llamando; el resto (crear/borrar/
// buscar dietas) desapareció con la colección: ya no existe el objeto que
// creaban.
module.exports = {
  async getDietById(req, res) {
    const diet = await dietModel.getDietById(req.params.id);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },

  async getRecentMealProducts(req, res) {
    const products = await dietModel.getRecentMealProducts(req.params.id, {
      mealIndex: req.query.mealIndex,
      limit: req.query.limit,
    });

    return res.send(products);
  },

  async getRecentMealRecipes(req, res) {
    const recipes = await dietModel.getRecentMealRecipes(req.params.id, {
      mealIndex: req.query.mealIndex,
      limit: req.query.limit,
    });

    return res.send(recipes);
  },

  // No-op con respuesta válida: el día ya nace con dueño.
  async addDietDietDay(req, res) {
    const diet = await dietModel.addDietDietDay(req.params.idDiet);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },

  async updatePinnedNote(req, res) {
    const diet = await dietModel.updatePinnedNote(req.params.id, req.body.notes);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },
};
