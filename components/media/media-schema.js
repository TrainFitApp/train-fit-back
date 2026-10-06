const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { PURPOSE_IDS } = require("./media-catalog");

// Un archivo subido (foto o vídeo) y dónde vive. Los documentos de dominio
// (días de progreso, revisiones de técnica, biblioteca del entrenador) solo
// guardan el _id de su MediaAsset; las URL se firman en cada lectura y nunca
// se guardan (docs/plan-medidas-multimedia.md).
const MediaAssetSchema = new Schema(
  {
    // Quien sube (cupos y límites).
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // De quién es el contenido: el cliente en fotos, progreso y revisiones;
    // el propio entrenador en su biblioteca. Manda en el acceso y la cascada.
    subjectId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: PURPOSE_IDS, required: true },
    kind: { type: String, enum: ["image", "video"], required: true },
    // Dónde está el original (image: r2|local, video: bunny|local).
    provider: { type: String, enum: ["r2", "bunny", "local"], required: true },
    // Proveedor de la miniatura (siempre almacenamiento de imágenes).
    thumbProvider: { type: String, enum: ["r2", "local", null], default: null },
    key: { type: String, default: null },
    thumbKey: { type: String, default: null },
    bunnyLibrary: { type: String, enum: ["client", "trainer", null], default: null },
    bunnyVideoId: { type: String, default: null, index: { sparse: true } },
    // Resolución del MP4 que se reproduce (Bunny, "MP4 fallback").
    playbackResolution: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "processing", "ready", "failed"],
      default: "pending",
    },
    mime: { type: String, required: true },
    bytes: { type: Number, required: true },
    thumbMime: { type: String, default: null },
    thumbBytes: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSec: { type: Number, default: null },
    // Retención (revisiones de técnica). null = permanente.
    expiresAt: { type: Date, default: null },
    processingCheckedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    readyAt: { type: Date, default: null },
  },
  { collection: "mediaassets" }
);

MediaAssetSchema.index({ subjectId: 1, purpose: 1, createdAt: -1 });
MediaAssetSchema.index({ ownerId: 1, status: 1, createdAt: 1 });

// Borrar un MediaAsset borra también sus archivos en remoto. Lo que falle se
// apunta en MediaPurge y se reintenta bajo demanda (media-service.js): nunca
// quedan archivos huérfanos en silencio.
async function purgeRemote(assets) {
  if (!assets.length) return;
  await require("./media-purge").purgeAssets(assets);
}

MediaAssetSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    const assets = await this.model.find(this.getQuery()).lean();
    await purgeRemote(assets);
    next();
  } catch (error) {
    next(error);
  }
});

MediaAssetSchema.pre("deleteMany", async function (next) {
  try {
    const assets = await this.model.find(this.getQuery()).lean();
    await purgeRemote(assets);
    next();
  } catch (error) {
    next(error);
  }
});

MediaAssetSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["ownerId", "subjectId"] });

module.exports = mongoose.model("MediaAsset", MediaAssetSchema);
