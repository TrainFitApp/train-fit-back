const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Vídeo concreto que el entrenador pone a UN cliente para UN ejercicio
// («para ti, hazlo con esta variante»). Manda sobre el vídeo por defecto del
// entrenador para ese ejercicio.
const TechniqueVideoOverrideSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    exerciseId: { type: Schema.Types.ObjectId, ref: "Exercise", required: true },
    techniqueVideoId: { type: Schema.Types.ObjectId, ref: "TechniqueVideo", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "techniquevideooverrides" }
);

TechniqueVideoOverrideSchema.index({ trainerId: 1, clientId: 1, exerciseId: 1 }, { unique: true });

module.exports = mongoose.model("TechniqueVideoOverride", TechniqueVideoOverrideSchema);
