const mongoose = require("mongoose");
const MediaAsset = require("./media-schema");

module.exports = {
  newId() {
    return new mongoose.Types.ObjectId();
  },

  async create(data) {
    return (await MediaAsset.create(data)).toObject();
  },

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return MediaAsset.findById(id).lean();
  },

  async findByIds(ids) {
    const valid = (ids || []).filter((id) => mongoose.isValidObjectId(id));
    if (!valid.length) return [];
    return MediaAsset.find({ _id: { $in: valid } }).lean();
  },

  async findByBunnyVideoId(videoId) {
    return MediaAsset.findOne({ bunnyVideoId: videoId }).lean();
  },

  async update(id, set) {
    return MediaAsset.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
  },

  // Borra con el hook que limpia los archivos en remoto (media-schema.js).
  async deleteByIds(ids) {
    const valid = (ids || []).filter((id) => mongoose.isValidObjectId(id));
    if (!valid.length) return;
    await MediaAsset.deleteMany({ _id: { $in: valid } });
  },

  async deleteStalePending(ownerId, olderThan) {
    await MediaAsset.deleteMany({ ownerId, status: "pending", createdAt: { $lt: olderThan } });
  },

  // Bytes de la biblioteca del entrenador (lo que no ha fallado).
  async sumLibraryBytes(trainerId) {
    const [row] = await MediaAsset.aggregate([
      {
        $match: {
          ownerId: new mongoose.Types.ObjectId(String(trainerId)),
          purpose: "technique_video",
          status: { $ne: "failed" },
        },
      },
      { $group: { _id: null, bytes: { $sum: "$bytes" } } },
    ]);
    return row?.bytes || 0;
  },
};

// Consentimiento explícito de fotos y vídeos (RGPD), con fecha.
module.exports.setConsent = async function setConsent(userId, at = new Date()) {
  const User = require("../users/schema");
  await User.updateOne({ _id: userId }, { $set: { mediaConsentAt: at } });
  return at;
};
