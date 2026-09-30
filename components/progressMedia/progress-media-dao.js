const mongoose = require("mongoose");
const ProgressMediaDay = require("./progress-media-schema");

const MAX_DAYS = 400;

module.exports = {
  async findDay(userId, date) {
    return ProgressMediaDay.findOne({ userId, date }).lean();
  },

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return ProgressMediaDay.findById(id).lean();
  },

  async listRange(userId, { from, to } = {}) {
    const query = { userId };
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }
    return ProgressMediaDay.find(query).sort({ date: -1 }).limit(MAX_DAYS).lean();
  },

  async countBefore(userId, date) {
    return ProgressMediaDay.countDocuments({ userId, date: { $lt: date } });
  },

  /** Pone (o cambia) la foto de una pose. Devuelve { day, replacedAssetId }. */
  async setPhoto(userId, date, pose, assetId) {
    const existing = await ProgressMediaDay.findOne({ userId, date }).lean();
    const replaced = existing?.photos?.find((photo) => photo.pose === pose)?.assetId || null;
    const photos = (existing?.photos || []).filter((photo) => photo.pose !== pose);
    photos.push({ pose, assetId });
    const day = await ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $set: { photos, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return { day, replacedAssetId: replaced };
  },

  async removePhoto(userId, date, pose) {
    const existing = await ProgressMediaDay.findOne({ userId, date }).lean();
    const removed = existing?.photos?.find((photo) => photo.pose === pose)?.assetId || null;
    if (!removed) return { day: existing, removedAssetId: null };
    const day = await ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $pull: { photos: { pose } }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();
    return { day, removedAssetId: removed };
  },

  async addVideo(userId, date, assetId, note) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      {
        $push: { videos: { assetId, note: note || "", createdAt: new Date() } },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async removeVideo(userId, date, assetId) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $pull: { videos: { assetId } }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();
  },

  async updateMeta(userId, date, set) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $set: { ...set, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async linkCheckin(dayId, responseId, trainerId) {
    await ProgressMediaDay.updateOne(
      { _id: dayId, "checkins.responseId": { $ne: responseId } },
      { $push: { checkins: { responseId, trainerId } } }
    );
  },

  // Un día sin fotos, vídeos ni check-ins no aporta nada: se quita (sin
  // disparar la cascada, ya no tiene archivos).
  async deleteIfEmpty(userId, date) {
    await ProgressMediaDay.collection.deleteOne({
      userId: new mongoose.Types.ObjectId(String(userId)),
      date,
      photos: { $size: 0 },
      videos: { $size: 0 },
      checkins: { $size: 0 },
      $or: [{ note: "" }, { note: { $exists: false } }],
    });
  },
};
