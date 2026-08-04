const nutritionPreferencesDao = require("./nutrition-preferences-dao");

const COOKS_AT_HOME_VALUES = ["yes", "no", "sometimes"];

module.exports = {
  // GET /nutrition-preferences — cliente, las suyas propias (o null si nunca respondió/solicitaron).
  async getMine(req, res) {
    const preferences = await nutritionPreferencesDao.getByClientId(req.auth.userId);
    return res.send(preferences);
  },

  // PUT /nutrition-preferences — cliente, rellena/edita y marca respondedAt.
  async updateMine(req, res) {
    const { allergies, favoriteFoods, dislikedFoods, cooksAtHome } = req.body || {};

    if (cooksAtHome != null && !COOKS_AT_HOME_VALUES.includes(cooksAtHome)) {
      return res.status(400).send({ message: "cooksAtHome debe ser 'yes', 'no' o 'sometimes'" });
    }
    if ([allergies, favoriteFoods, dislikedFoods].some((v) => v != null && String(v).length > 1000)) {
      return res.status(400).send({ message: "Cada campo de texto no puede superar los 1000 caracteres" });
    }

    const preferences = await nutritionPreferencesDao.upsertOwnResponse(req.auth.userId, {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
    });
    return res.send(preferences);
  },
};
