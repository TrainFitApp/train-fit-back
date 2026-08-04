const TrainerNote = require("./trainer-note-schema");

module.exports = {
  async create(trainerId, clientId, text) {
    return TrainerNote.create({ trainerId, clientId, text });
  },

  async list(trainerId, clientId) {
    return TrainerNote.find({ trainerId, clientId })
      .sort({ pinned: -1, createdAt: -1 })
      .lean();
  },

  async setPinned(trainerId, clientId, noteId, pinned) {
    return TrainerNote.findOneAndUpdate(
      { _id: noteId, trainerId, clientId },
      { $set: { pinned: Boolean(pinned) } },
      { new: true }
    ).lean();
  },
};
