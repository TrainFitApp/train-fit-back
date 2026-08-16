const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Solo guarda campos storage:"wellbeing" del catálogo — composición
// corporal/perímetros (storage:"anthropometry") se escriben en el modelo
// Anthropometry existente, no aquí (funcionalidad 10).
const CheckinResponseSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  respondedAt: { type: Date, default: Date.now },
  values: { type: Schema.Types.Mixed, required: true }, // { [fieldKey]: number|string }, solo claves wellbeing
  seenByTrainer: { type: Boolean, default: false },
});

CheckinResponseSchema.index({ trainerId: 1, clientId: 1, respondedAt: -1 });

module.exports = mongoose.model("CheckinResponse", CheckinResponseSchema);
