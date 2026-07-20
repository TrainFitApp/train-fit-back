const AppConfig = require("./remote-config-schema");

module.exports = {
  async getConfig() {
    const existing = await AppConfig.findOne().lean();
    if (existing) return existing;

    const created = await AppConfig.create({});
    return created.toObject();
  },

  async saveConfig(patch) {
    return AppConfig.findOneAndUpdate(
      {},
      { $set: patch },
      { new: true, upsert: true }
    ).lean();
  },
};
