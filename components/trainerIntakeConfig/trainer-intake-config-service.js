const trainerIntakeConfigDao = require("./trainer-intake-config-dao");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

module.exports = {
  async getMyConfig(trainerId) {
    const config = await trainerIntakeConfigDao.getByTrainer(trainerId);
    return { trainerId, enabledFields: config ? config.enabledFields : [...INTAKE_FIELD_KEYS] };
  },

  async updateMyConfig(trainerId, enabledFields) {
    if (!Array.isArray(enabledFields) || !enabledFields.every((f) => INTAKE_FIELD_KEYS.includes(f))) {
      const err = new Error("enabledFields contiene una clave no reconocida en el catálogo");
      err.code = "INVALID_INTAKE_FIELDS";
      throw err;
    }
    const config = await trainerIntakeConfigDao.upsert(trainerId, enabledFields);
    return { trainerId, enabledFields: config.enabledFields };
  },

  async getEnabledFieldsByTrainer(trainerId) {
    return trainerIntakeConfigDao.getEnabledFieldsByTrainer(trainerId);
  },

  async getEnabledFieldsByTrainers(trainerIds) {
    return trainerIntakeConfigDao.getEnabledFieldsByTrainers(trainerIds);
  },
};
