const TrainerNote = require("./trainer-note-schema");

module.exports = {
  async create(trainerId, clientId, text) {
    const { stage } = await require("../clientOverview/stage-service").resolveStage(trainerId, clientId, null, { write: true });
    return TrainerNote.create({ trainerId, clientId, text, stageId: stage._id });
  },

  async list(trainerId, clientId) {
    return TrainerNote.find({ trainerId, clientId })
      .sort({ pinned: -1, createdAt: -1 })
      .lean();
  },

  async setPinned(trainerId, clientId, noteId, pinned) {
    const { resolveStage, stageFilter, recheckAccess } = require("../clientOverview/stage-service");
    const { stage } = await resolveStage(trainerId, clientId, null, { write: true });
    await recheckAccess(trainerId, clientId, stage._id);
    return TrainerNote.findOneAndUpdate(
      { _id: noteId, trainerId, clientId, ...stageFilter(stage) },
      { $set: { pinned: Boolean(pinned), updatedAt: new Date() }, $inc: { version: 1 } },
      { new: true }
    ).lean();
  },
};
