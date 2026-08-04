const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// MVP-trainers F17/D8 (2026-08-01) — SOLO guarda campos storage:"wellbeing"
// del catálogo (11 posibles). Composición corporal y perímetros se escriben
// en Anthropometry, no aquí (ver modelos-de-datos/04-catalogo-campos-checkin.md).
const CheckinResponseSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  respondedAt: { type: Date, default: Date.now },
  values: { type: Schema.Types.Mixed, required: true }, // { [fieldKey]: number }, solo claves wellbeing-backed
}, { collection: "checkinresponses" });

CheckinResponseSchema.index({ trainerId: 1, clientId: 1, respondedAt: -1 });

module.exports = mongoose.model("CheckinResponse", CheckinResponseSchema);
