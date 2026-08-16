const dao = require("./trainer-intake-config-dao");
const { INTAKE_FIELDS } = require("../clientIntake/intake-field-catalog");

const VALID_KEYS = Object.keys(INTAKE_FIELDS);

module.exports = {
  async getMine(req, res) {
    const config = await dao.findByTrainerId(req.user.id);
    return res.send({
      enabledFields: config?.enabledFields || VALID_KEYS,
    });
  },

  async updateMine(req, res) {
    const requested = Array.isArray(req.body?.enabledFields)
      ? req.body.enabledFields
      : [];
    const enabledFields = requested.filter((key) => VALID_KEYS.includes(key));

    const config = await dao.upsert(req.user.id, enabledFields);
    return res.send({ enabledFields: config.enabledFields });
  },

  async getCatalog(req, res) {
    return res.send({ fields: VALID_KEYS });
  },

  // Lado cliente: qué campos activó ESE trainer en concreto, para pintar el
  // formulario de cuestionario inicial con los campos correctos.
  async getForTrainer(req, res) {
    const config = await dao.findByTrainerId(req.params.trainerId);
    return res.send({
      enabledFields: config?.enabledFields || VALID_KEYS,
    });
  },
};
