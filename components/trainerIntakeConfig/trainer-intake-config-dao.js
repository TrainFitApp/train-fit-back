const User = require("../users/user-schema");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

// La configuración vive en User.trainerSettings.intake (2026-10). Se
// devuelve con `trainerId`, como el documento de la colección antigua; null
// sin configuración guardada.
const PATH = "trainerSettings.intake";

function present(user) {
  const config = user?.trainerSettings?.intake;
  return config ? { trainerId: user._id, ...config } : null;
}

async function listByTrainers(trainerIds) {
  if (!trainerIds.length) return new Map();
  const users = await User.find({ _id: { $in: trainerIds }, [PATH]: { $exists: true } })
    .select(PATH)
    .lean();
  return new Map(users.map((user) => [String(user._id), user.trainerSettings.intake]));
}

module.exports = {
  async getByTrainer(trainerId) {
    return present(await User.findById(trainerId).select(PATH).lean());
  },

  async getEnabledFieldsByTrainer(trainerId) {
    const config = await this.getByTrainer(trainerId);
    return config ? config.enabledFields : [...INTAKE_FIELD_KEYS];
  },

  // getOnboardingStatus (trainer-client-service.js) puede tener relaciones
  // pendientes de varios trainers a la vez (uno de training, otro de
  // nutrition) — un solo $in en vez de un findOne por trainerId, mismo
  // criterio que attachTrainerInfo en ese mismo archivo.
  async getEnabledFieldsByTrainers(trainerIds) {
    const byTrainer = await listByTrainers(trainerIds);
    return new Map(trainerIds.map((id) => [id, byTrainer.get(String(id))?.enabledFields || [...INTAKE_FIELD_KEYS]]));
  },

  async upsert(trainerId, enabledFields, customQuestions, lastScopes) {
    const user = await User.findOneAndUpdate(
      { _id: trainerId },
      {
        $set: {
          [`${PATH}.enabledFields`]: enabledFields,
          [`${PATH}.customQuestions`]: customQuestions,
          [`${PATH}.lastScopes`]: lastScopes,
          [`${PATH}.updatedAt`]: new Date(),
        },
      },
      { new: true, projection: { [PATH]: 1 }, runValidators: true }
    ).lean();
    return present(user);
  },

  // Mismo criterio que getEnabledFieldsByTrainers (un solo $in en vez de un
  // findOne por trainerId) — usado por getOnboardingStatus para que el
  // cliente sepa qué preguntas custom añadió cada uno de sus trainers.
  async getCustomQuestionsByTrainers(trainerIds) {
    const byTrainer = await listByTrainers(trainerIds);
    return new Map(trainerIds.map((id) => [id, byTrainer.get(String(id))?.customQuestions || []]));
  },
};
