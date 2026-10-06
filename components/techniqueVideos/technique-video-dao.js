const mongoose = require("mongoose");
const TechniqueVideo = require("./technique-video-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

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
    return TechniqueVideo.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
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

  // Asignaciones a clientes: viven en el par (trainerClients/trainer-client-schema.js).
  async listOverrides({ trainerIds, trainerId, clientId }) {
    return trainerClientDao.listTechniqueOverrides({ clientId, trainerId, trainerIds });
  },

  async setOverride(trainerId, clientId, exerciseId, techniqueVideoId) {
    return trainerClientDao.setTechniqueOverride(trainerId, clientId, exerciseId, techniqueVideoId);
  },

  async removeOverride(trainerId, clientId, exerciseId) {
    return trainerClientDao.removeTechniqueOverride(trainerId, clientId, exerciseId);
  },
};
