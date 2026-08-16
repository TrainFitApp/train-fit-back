const nutritionPreferencesService = require("./nutrition-preferences-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[NUTRITION_PREFERENCES] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async getMine(req, res) {
    const preferences = await nutritionPreferencesService.getMine(req.user.id);
    return res.send(preferences || {});
  },

  async updateMine(req, res) {
    const preferences = await nutritionPreferencesService.updateMine(req.user.id, req.body || {});
    return res.send(preferences);
  },

  async requestUpdate(req, res) {
    try {
      const preferences = await nutritionPreferencesService.requestUpdate(
        req.user.id,
        req.params.clientId
      );
      return res.status(201).send(preferences);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getForClient(req, res) {
    try {
      const preferences = await nutritionPreferencesService.getForClient(
        req.user.id,
        req.params.clientId
      );
      return res.send(preferences || {});
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
