const userSchema = require("../users/schema");

async function getForUser(userId) {
  const user = await userSchema.findById(userId).select("onboarding");
  return user?.onboarding || { pendingTutorials: [] };
}

module.exports = {
  getForUser,

  async completeTutorial(userId, key) {
    if (!key) return getForUser(userId);
    await userSchema.findByIdAndUpdate(userId, {
      $pull: { "onboarding.pendingTutorials": key },
      $set: { "onboarding.lastSyncAt": new Date() },
    });
    return getForUser(userId);
  },

  async reopenTutorial(userId, key) {
    if (!key) return getForUser(userId);
    await userSchema.findByIdAndUpdate(userId, {
      $addToSet: { "onboarding.pendingTutorials": key },
      $set: { "onboarding.lastSyncAt": new Date() },
    });
    return getForUser(userId);
  },
};
