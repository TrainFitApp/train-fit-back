const nutritionPreferencesService = require("./nutrition-preferences-service");

module.exports = {
  // GET /nutrition-preferences — cliente, las suyas propias (o null si nunca respondió/solicitaron).
  async getMine(req, res) {
    return res.send(await nutritionPreferencesService.getForClient(req.auth.userId));
  },

  // PUT /nutrition-preferences — cliente, rellena/edita y marca respondedAt.
  async updateMine(req, res) {
    return res.send(await nutritionPreferencesService.saveClientResponse(req.auth.userId, req.body));
  },
};
