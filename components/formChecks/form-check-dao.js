const mongoose = require("mongoose");
const FormCheck = require("./form-check-schema");

const LIST_LIMIT = 200;

module.exports = {
  async create(data) {
    return (await FormCheck.create(data)).toObject();
  },

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return FormCheck.findById(id).lean();
  },

  async countSince(clientId, since) {
    return FormCheck.countDocuments({ clientId, createdAt: { $gte: since } });
  },

  async listForClient(clientId, { exerciseId } = {}) {
    const query = { clientId };
    if (exerciseId && mongoose.isValidObjectId(exerciseId)) query.exerciseId = exerciseId;
    return FormCheck.find(query).sort({ createdAt: -1 }).limit(LIST_LIMIT).lean();
  },

  async listForTrainer(trainerId, { status, clientIds } = {}) {
    const query = { trainerId };
    if (status === "pending" || status === "reviewed") query.status = status;
    if (clientIds) query.clientId = { $in: clientIds };
    return FormCheck.find(query)
      .populate("clientId", "name lastname email")
      .sort({ status: 1, createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean();
  },

  async countPendingForTrainer(trainerId, clientIds) {
    return FormCheck.countDocuments({ trainerId, status: "pending", clientId: { $in: clientIds } });
  },

  async update(id, set) {
    return FormCheck.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
  },

  async pushComment(id, comment) {
    return FormCheck.findByIdAndUpdate(id, { $push: { comments: comment } }, { new: true }).lean();
  },

  async pullComment(id, commentId) {
    return FormCheck.findByIdAndUpdate(id, { $pull: { comments: { _id: commentId } } }, { new: true }).lean();
  },

  // Borrado con cascada al vídeo (hook del schema).
  async deleteById(id) {
    await FormCheck.deleteOne({ _id: id });
  },

  async deleteExpired(filter, now = new Date()) {
    await FormCheck.deleteMany({ ...filter, keep: false, expiresAt: { $ne: null, $lt: now } });
  },

  async findExpiringUnnotified(trainerId, until) {
    return FormCheck.find({
      trainerId,
      keep: false,
      expiresAt: { $ne: null, $lte: until },
      expiryNotifiedAt: null,
    }).lean();
  },
};
