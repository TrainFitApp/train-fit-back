const User = require("../users/user-schema");

// La configuración vive en User.trainerSettings.intake. Se devuelve con el
// `trainerId` de su dueño; null sin configuración guardada.
const PATH = "trainerSettings.intake";

function present(user) {
  const config = user?.trainerSettings?.intake;
  return config ? { trainerId: user._id, ...config } : null;
}

module.exports = {
  async getByTrainer(trainerId) {
    return present(await User.findById(trainerId).select(PATH).lean());
  },

  async upsert(trainerId, { enabledFields, customQuestions, measurements, photos, videos, lastScopes }) {
    const user = await User.findOneAndUpdate(
      { _id: trainerId },
      {
        $set: {
          [`${PATH}.enabledFields`]: enabledFields,
          [`${PATH}.customQuestions`]: customQuestions,
          [`${PATH}.measurements`]: measurements,
          [`${PATH}.photos`]: photos,
          [`${PATH}.videos`]: videos,
          [`${PATH}.lastScopes`]: lastScopes,
          [`${PATH}.updatedAt`]: new Date(),
        },
      },
      { new: true, projection: { [PATH]: 1 }, runValidators: true }
    ).lean();
    return present(user);
  },
};
