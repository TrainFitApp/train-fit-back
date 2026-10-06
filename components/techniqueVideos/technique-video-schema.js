const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Biblioteca de vídeos de técnica del entrenador: subidos (Bunny) o enlaces
// de YouTube/Vimeo, vinculados a ejercicios. El cliente ve el vídeo de su
// entrenador en lugar del genérico del catálogo (docs/plan-medidas-multimedia.md).
const TechniqueVideoSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, trim: true, required: true, maxlength: 120 },
    // Claves técnicas en texto («codos pegados, bajar en 3 s»).
    cues: { type: String, trim: true, maxlength: 1000, default: "" },
    source: { type: String, enum: ["upload", "youtube", "vimeo"], required: true },
    assetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    externalUrl: { type: String, trim: true, maxlength: 500, default: null },
    // Vídeo por defecto del entrenador para estos ejercicios, para todos sus
    // clientes de entrenamiento.
    exerciseIds: { type: [{ type: Schema.Types.ObjectId, ref: "Exercise" }], default: [] },
  },
  { collection: "techniquevideos", timestamps: true }
);

TechniqueVideoSchema.index({ trainerId: 1, exerciseIds: 1 });

async function cascade(model, query) {
  const videos = await model.find(query).select("_id assetId trainerId").lean();
  if (!videos.length) return;
  const assetIds = videos.map((video) => video.assetId).filter(Boolean);
  if (assetIds.length) await require("../media/media-schema").deleteMany({ _id: { $in: assetIds } });
  const trainerClientDao = require("../trainerClients/trainer-client-dao");
  const byTrainer = new Map();
  for (const video of videos) {
    const key = String(video.trainerId);
    byTrainer.set(key, [...(byTrainer.get(key) || []), video._id]);
  }
  for (const [trainerId, videoIds] of byTrainer) {
    await trainerClientDao.removeTechniqueOverridesOfVideos(trainerId, videoIds);
  }
}

// Borrar un vídeo borra su archivo y las asignaciones a clientes.
TechniqueVideoSchema.pre("deleteMany", async function (next) {
  try {
    await cascade(this.model, this.getQuery());
    next();
  } catch (error) {
    next(error);
  }
});

TechniqueVideoSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    await cascade(this.model, this.getQuery());
    next();
  } catch (error) {
    next(error);
  }
});

TechniqueVideoSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"] });

module.exports = mongoose.model("TechniqueVideo", TechniqueVideoSchema);
