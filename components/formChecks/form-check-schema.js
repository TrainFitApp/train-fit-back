const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Revisión de técnica: el cliente graba una serie y se la manda a su
// entrenador con el contexto de esa serie. El entrenador responde con
// comentarios anclados a un segundo del vídeo (docs/plan-medidas-multimedia.md).
const FormCheckCommentSchema = new Schema({
  // Segundo del vídeo al que se refiere. null = comentario general.
  atSec: { type: Number, default: null, min: 0 },
  text: { type: String, trim: true, maxlength: 1000, default: "" },
  // Vídeo de la biblioteca del entrenador («así es como debe verse»).
  techniqueVideoId: { type: Schema.Types.ObjectId, ref: "TechniqueVideo", default: null },
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

const FormCheckSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", required: true },
    exerciseId: { type: Schema.Types.ObjectId, ref: "Exercise", default: null },
    // Copia del nombre: el ejercicio puede renombrarse o borrarse después.
    exerciseName: { type: String, trim: true, maxlength: 200, default: "" },
    tableId: { type: Schema.Types.ObjectId, ref: "Table", default: null },
    date: { type: String, required: true }, // "YYYY-MM-DD" de la sesión
    // Copia de la serie al enviar (prescrito y ejecutado, sin mezclar): la
    // serie puede editarse después y la revisión tiene que seguir diciendo
    // qué se hizo en ESE vídeo.
    setSnapshot: { type: Schema.Types.Mixed, default: null },
    clientNote: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: ["pending", "reviewed"], default: "pending" },
    reviewedAt: { type: Date, default: null },
    comments: { type: [FormCheckCommentSchema], default: [] },
    trainerSeenAt: { type: Date, default: null },
    clientSeenAt: { type: Date, default: null },
    // Retención: 90 días salvo «Conservar» (decisión 2).
    keep: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    expiryNotifiedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "formchecks" }
);

// Un vídeo, una revisión: borrar una revisión borra su vídeo, así que dos
// revisiones con el mismo vídeo dejaban a la otra sin él (doble toque en
// «Enviar»).
FormCheckSchema.index({ assetId: 1 }, { unique: true });
FormCheckSchema.index({ trainerId: 1, status: 1, createdAt: -1 });
FormCheckSchema.index({ clientId: 1, exerciseId: 1, createdAt: -1 });
FormCheckSchema.index({ expiresAt: 1 }, { sparse: true });

async function deleteAssetsOf(model, query) {
  const checks = await model.find(query).select("assetId").lean();
  const ids = checks.map((check) => check.assetId).filter(Boolean);
  if (ids.length) await require("../media/media-schema").deleteMany({ _id: { $in: ids } });
}

// Borrar revisiones borra sus vídeos (y los archivos en remoto).
FormCheckSchema.pre("deleteMany", async function (next) {
  try {
    await deleteAssetsOf(this.model, this.getQuery());
    next();
  } catch (error) {
    next(error);
  }
});

FormCheckSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    await deleteAssetsOf(this.model, this.getQuery());
    next();
  } catch (error) {
    next(error);
  }
});

FormCheckSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["clientId", "trainerId"], authorship: ["comments.authorId"] });

module.exports = mongoose.model("FormCheck", FormCheckSchema);
