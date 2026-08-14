const TrainerIntakeConfig = require("./trainer-intake-config-schema");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

module.exports = {
  async getByTrainer(trainerId) {
    return TrainerIntakeConfig.findOne({ trainerId }).lean();
  },

  async getEnabledFieldsByTrainer(trainerId) {
    const config = await TrainerIntakeConfig.findOne({ trainerId }).lean();
    return config ? config.enabledFields : [...INTAKE_FIELD_KEYS];
  },

  // getOnboardingStatus (trainer-client-service.js) puede tener relaciones
  // pendientes de varios trainers a la vez (uno de training, otro de
  // nutrition) — un solo $in en vez de un findOne por trainerId, mismo
  // criterio que attachTrainerInfo en ese mismo archivo.
  async getEnabledFieldsByTrainers(trainerIds) {
    const configs = await TrainerIntakeConfig.find({ trainerId: { $in: trainerIds } }).lean();
    const byTrainer = new Map(configs.map((c) => [String(c.trainerId), c.enabledFields]));
    return new Map(trainerIds.map((id) => [id, byTrainer.get(id) || [...INTAKE_FIELD_KEYS]]));
  },

  async upsert(trainerId, enabledFields) {
    return TrainerIntakeConfig.findOneAndUpdate(
      { trainerId },
      { $set: { enabledFields, updatedAt: new Date() } },
      { new: true, upsert: true }
    ).lean();
  },
};
