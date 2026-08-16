const mealProposalSchema = require("./meal-proposal-schema");

module.exports = {
  async create(data) {
    return mealProposalSchema.create(data);
  },

  async findById(id) {
    return mealProposalSchema.findById(id);
  },

  async findByIdPopulated(id) {
    return mealProposalSchema
      .findById(id)
      .populate({
        path: "alternatives.meal",
        populate: { path: "customProducts", populate: { path: "product" } },
      })
      .lean();
  },

  async findPendingByClient(clientId) {
    return mealProposalSchema
      .find({ clientId, chosenIndex: null })
      .populate({
        path: "alternatives.meal",
        populate: { path: "customProducts", populate: { path: "product" } },
      })
      .sort({ date: 1 })
      .lean();
  },

  async findByTrainerAndClient(trainerId, clientId) {
    return mealProposalSchema
      .find({ trainerId, clientId })
      .sort({ date: -1 })
      .lean();
  },

  async markChosen(id, chosenIndex) {
    return mealProposalSchema.findByIdAndUpdate(id, { $set: { chosenIndex } }, { new: true });
  },
};
