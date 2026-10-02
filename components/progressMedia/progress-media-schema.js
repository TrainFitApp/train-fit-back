const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { POSES } = require("../media/media-catalog");

// Un día de progreso del cliente: sus fotos por pose y sus vídeos de
// progreso (posing, movilidad…). Se enlaza por fecha con la Anthropometry de
// ese día, así que el peso y los perímetros se ven junto a las fotos sin
// guardarlos dos veces (docs/plan-medidas-multimedia.md).
const ProgressMediaDaySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    photos: {
      type: [
        new Schema(
          {
            pose: { type: String, enum: POSES, required: true },
            assetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    videos: {
      type: [
        new Schema(
          {
            assetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", required: true },
            note: { type: String, trim: true, maxlength: 500, default: "" },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    // Decisión 4: compartido por defecto con los profesionales activos; el
    // cliente puede ocultar el día entero.
    hiddenFromTrainers: { type: Boolean, default: false },
    // Check-ins que se respondieron con este día. Para el profesional que lo
    // pidió, el día es siempre visible (responder ya es enviárselo).
    checkins: {
      type: [
        new Schema(
          {
            responseId: { type: Schema.Types.ObjectId, ref: "CheckinResponse", required: true },
            trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "progressmediadays" }
);

ProgressMediaDaySchema.index({ userId: 1, date: -1 }, { unique: true });

function assetIdsOf(days) {
  return days.flatMap((day) => [
    ...(day.photos || []).map((photo) => photo.assetId),
    ...(day.videos || []).map((video) => video.assetId),
  ]);
}

// Borrar días borra sus fotos y vídeos (y, por el hook de MediaAsset, los
// archivos en remoto).
ProgressMediaDaySchema.pre("deleteMany", async function (next) {
  try {
    const days = await this.model.find(this.getQuery()).select("photos videos").lean();
    const ids = assetIdsOf(days);
    if (ids.length) await require("../media/media-schema").deleteMany({ _id: { $in: ids } });
    next();
  } catch (error) {
    next(error);
  }
});

ProgressMediaDaySchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    const days = await this.model.find(this.getQuery()).select("photos videos").lean();
    const ids = assetIdsOf(days);
    if (ids.length) await require("../media/media-schema").deleteMany({ _id: { $in: ids } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("ProgressMediaDay", ProgressMediaDaySchema);
