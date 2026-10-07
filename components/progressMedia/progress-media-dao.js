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

  /**
   * Pone (o cambia) la foto de una pose. Devuelve { replacedAssetId }: la
   * que había antes en esa pose, o null. Cada pose se escribe con una sola
   * operación atómica (nunca leer el día y reescribir la lista entera): dos
   * fotos subidas a la vez, frente y perfil, se quedan las dos, y la que se
   * sustituye es la que había de verdad.
   */
  async setPhoto(userId, date, pose, assetId) {
    for (let attempt = 1; ; attempt += 1) {
      // Ya hay foto de esa pose: se cambia en su sitio.
      const before = await ProgressMediaDay.findOneAndUpdate(
        { userId, date, "photos.pose": pose },
        { $set: { "photos.$.assetId": assetId } },
        { new: false }
      ).lean();
      if (before) {
        return { replacedAssetId: before.photos.find((photo) => photo.pose === pose)?.assetId || null };
      }
      // No la hay: se añade (y el día se crea si no existe).
      try {
        await ProgressMediaDay.findOneAndUpdate(
          { userId, date, "photos.pose": { $ne: pose } },
          { $push: { photos: { pose, assetId } } },
          { upsert: true, setDefaultsOnInsert: true }
        );
        return { replacedAssetId: null };
      } catch (error) {
        // Entretanto otra petición creó el día con esa pose: el filtro ya no
        // casa y el alta choca con el índice único. Se repite y se sustituye.
        if (error?.code !== 11000 || attempt >= 3) throw error;
      }
    }
  },

  /** Quita la foto de una pose, atómico. Devuelve { removedAssetId } o null si no había. */
  async removePhoto(userId, date, pose) {
    const before = await ProgressMediaDay.findOneAndUpdate(
      { userId, date, "photos.pose": pose },
      { $pull: { photos: { pose } } },
      { new: false }
    ).lean();
    return { removedAssetId: before?.photos.find((photo) => photo.pose === pose)?.assetId || null };
  },

  async addVideo(userId, date, assetId, note) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      {
        $push: { videos: { assetId, note: note || "", createdAt: new Date() } },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async removeVideo(userId, date, assetId) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $pull: { videos: { assetId } } },
      { new: true }
    ).lean();
  },

  async updateMeta(userId, date, set) {
    return ProgressMediaDay.findOneAndUpdate(
      { userId, date },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async linkCheckin(dayId, responseId, trainerId) {
    await ProgressMediaDay.updateOne(
      { _id: dayId, "checkins.responseId": { $ne: responseId } },
      { $push: { checkins: { responseId, trainerId } } }
    );
  },

  // Los días enviados con el cuestionario de alta de `trainerId` (una vez
  // por profesional).
  async linkIntake(dayIds, trainerId) {
    if (!dayIds.length) return;
    await ProgressMediaDay.updateMany(
      { _id: { $in: dayIds }, "intakes.trainerId": { $ne: trainerId } },
      { $push: { intakes: { trainerId } } }
    );
  },

  // Los días del cliente que contienen alguno de estos vídeos.
  async findDaysWithVideos(userId, assetIds) {
    if (!assetIds.length) return [];
    return ProgressMediaDay.find({ userId, "videos.assetId": { $in: assetIds } }).select("videos.assetId").lean();
  },

  // Un día sin fotos, vídeos, check-ins ni cuestionario no aporta nada: se
  // quita (sin disparar la cascada, ya no tiene archivos). `intakes` con
  // $exists: los días anteriores a ese campo no lo tienen.
  async deleteIfEmpty(userId, date) {
    await ProgressMediaDay.collection.deleteOne({
      userId: new mongoose.Types.ObjectId(String(userId)),
      date,
      photos: { $size: 0 },
      videos: { $size: 0 },
      checkins: { $size: 0 },
      "intakes.0": { $exists: false },
      $or: [{ note: "" }, { note: { $exists: false } }],
    });
  },
};
