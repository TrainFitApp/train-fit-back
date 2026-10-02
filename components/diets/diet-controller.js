const dietModel = require("./diet-model");
const { canActOnSubject } = require("../trainerClients/subject-access");

const FORBIDDEN = { message: "No tienes permiso sobre la dieta de este usuario" };

// Capa de compatibilidad — ver cabecera de diet-dao.js. Solo quedan los
// endpoints que las apps instaladas siguen llamando; el resto (crear/borrar/
// buscar dietas) desapareció con la colección: ya no existe el objeto que
// creaban.
module.exports = {
  // El :id es el del usuario dueño de la "dieta": solo él (o un admin). Los
  // recientes también los lee su profesional de nutrición (al pautar).
  async getDietById(req, res) {
    if (!(await canActOnSubject(req, req.params.id))) return res.sendStatus(404);
    const diet = await dietModel.getDietById(req.params.id);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },

  async getRecentMealProducts(req, res) {
    if (!(await canActOnSubject(req, req.params.id, { trainerScope: "nutrition" }))) {
      return res.status(403).send(FORBIDDEN);
    }
    const products = await dietModel.getRecentMealProducts(req.params.id, {
      mealIndex: req.query.mealIndex,
      limit: req.query.limit,
    });

    return res.send(products);
  },

  async getRecentMealRecipes(req, res) {
    if (!(await canActOnSubject(req, req.params.id, { trainerScope: "nutrition" }))) {
      return res.status(403).send(FORBIDDEN);
    }
    const recipes = await dietModel.getRecentMealRecipes(req.params.id, {
      mealIndex: req.query.mealIndex,
      limit: req.query.limit,
    });

    return res.send(recipes);
  },

  // No-op con respuesta válida: el día ya nace con dueño.
  async addDietDietDay(req, res) {
    if (!(await canActOnSubject(req, req.params.idDiet))) return res.sendStatus(404);
    const diet = await dietModel.addDietDietDay(req.params.idDiet);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },

  async updatePinnedNote(req, res) {
    if (!(await canActOnSubject(req, req.params.id))) return res.status(403).send(FORBIDDEN);
    const diet = await dietModel.updatePinnedNote(req.params.id, req.body.notes);
    if (!diet) return res.sendStatus(404);
    return res.send(diet);
  },
};
