const trainerIntakeConfigService = require("./trainer-intake-config-service");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

module.exports = {
  // GET /trainer/intake-config — el propio profesional consulta su config
  async getMyConfig(req, res) {
    const config = await trainerIntakeConfigService.getMyConfig(req.auth.userId);
    return res.send({ ...config, catalog: INTAKE_FIELD_KEYS });
  },

  // PUT /trainer/intake-config — body: { enabledFields: [...], customQuestions: [{ label }], lastScopes: [...] }
  async updateMyConfig(req, res) {
    const { enabledFields, customQuestions, lastScopes } = req.body || {};
    try {
      const config = await trainerIntakeConfigService.updateMyConfig(
        req.auth.userId,
        enabledFields || [],
        customQuestions || [],
        lastScopes || []
      );
      return res.send(config);
    } catch (e) {
      if (e.code === "INVALID_INTAKE_FIELDS" || e.code === "INVALID_CUSTOM_QUESTIONS" || e.code === "INVALID_LAST_SCOPES") {
        return res.status(400).send({ message: e.message, code: e.code });
      }
      throw e;
    }
  },
};
