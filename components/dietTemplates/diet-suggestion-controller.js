const dietSuggestionService = require("./diet-suggestion-service");

module.exports = {
  // POST /trainer/clients/:clientId/diet-suggestions
  // body: { target?: { kcal, protein, carbs, fat }, dietaryFlags?, sources?, proteinPerKg?, fatPerKg? }
  // 422 MISSING_BIOMETRICS (con `missing`) si al cliente le faltan datos para
  // calcular su necesidad.
  async suggest(req, res) {
    return res.send(await dietSuggestionService.suggest(req.auth.userId, req.params.clientId, req.body || {}));
  },
};
