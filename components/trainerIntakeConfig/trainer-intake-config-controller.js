const trainerIntakeConfigService = require("./trainer-intake-config-service");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

module.exports = {
  // GET /trainer/intake-config — el propio profesional consulta su config
  async getMyConfig(req, res) {
    const config = await trainerIntakeConfigService.getMyConfig(req.auth.userId);
    return res.send({ ...config, catalog: INTAKE_FIELD_KEYS });
  },

  // PUT /trainer/intake-config — { enabledFields, customQuestions, lastScopes }
  async updateMyConfig(req, res) {
    return res.send(await trainerIntakeConfigService.updateMyConfig(req.auth.userId, req.body || {}));
  },
};
