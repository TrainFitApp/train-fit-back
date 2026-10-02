const mongoose = require("mongoose");
const TechniqueVideo = require("./technique-video-schema");
const Override = require("./technique-video-override-schema");

module.exports = {
  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return TechniqueVideo.findById(id).lean();
  },

  async findByIdWithExercises(id) {
    return TechniqueVideo.findById(id).populate("exerciseIds", "name").lean();
  },

  async findByIds(ids) {
    const valid = (ids || []).filter((id) => mongoose.isValidObjectId(id));
    if (!valid.length) return [];
    return TechniqueVideo.find({ _id: { $in: valid } }).populate("trainerId", "name lastname").lean();
  },

  async listByTrainer(trainerId) {
    return TechniqueVideo.find({ trainerId }).populate("exerciseIds", "name").sort({ updatedAt: -1 }).lean();
  },

  async create(data) {
    return (await TechniqueVideo.create(data)).toObject();
  },

  async update(id, set) {
    return TechniqueVideo.findByIdAndUpdate(id, { $set: { ...set, updatedAt: new Date() } }, { new: true }).lean();
  },

  async deleteById(id) {
    await TechniqueVideo.deleteOne({ _id: id });
  },

  // Vídeos por defecto de estos entrenadores para cualquier ejercicio.
  async listDefaultsOfTrainers(trainerIds) {
    return TechniqueVideo.find({ trainerId: { $in: trainerIds }, "exerciseIds.0": { $exists: true } })
      .populate("trainerId", "name lastname")
      .sort({ updatedAt: -1 })
      .lean();
  },

  async listOverrides({ trainerIds, trainerId, clientId }) {
    const query = { clientId };
    if (trainerId) query.trainerId = trainerId;
    if (trainerIds) query.trainerId = { $in: trainerIds };
    return Override.find(query).lean();
  },

  async setOverride(trainerId, clientId, exerciseId, techniqueVideoId) {
    return Override.findOneAndUpdate(
      { trainerId, clientId, exerciseId },
      { $set: { techniqueVideoId, createdAt: new Date() } },
      { new: true, upsert: true }
    ).lean();
  },

  async removeOverride(trainerId, clientId, exerciseId) {
    await Override.deleteOne({ trainerId, clientId, exerciseId });
  },
};
