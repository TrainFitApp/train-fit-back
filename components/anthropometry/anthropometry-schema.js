const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AnthropometrySchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  date: {
    type: String,
    required: true,
  },
  weight: { type: Number },
  // Campos de este día que vienen de un check-in pedido por el entrenador:
  // el cliente no los ve en sus pantallas (anthropometry-origin.js).
  checkinFields: { type: [String], default: undefined },
  neck: { type: Number },
  chest: { type: Number },
  waist: { type: Number },
  abdomen: { type: Number },
  hip: { type: Number },
  thighContracted: { type: Number },
  thighRelaxed: { type: Number },
  // Masas y perímetros por lado: los mismos campos para lo que apunta el
  // cliente y lo que pide el profesional en un check-in.
  muscleMass: { type: Number },
  fatMass: { type: Number },
  boneMass: { type: Number },
  residualMass: { type: Number },
  shoulders: { type: Number },
  quadL: { type: Number },
  quadR: { type: Number },
  ankleL: { type: Number },
  ankleR: { type: Number },
  bicepsRelaxedL: { type: Number },
  bicepsRelaxedR: { type: Number },
  bicepsContractedL: { type: Number },
  bicepsContractedR: { type: Number },
  calfL: { type: Number },
  calfR: { type: Number },
});

AnthropometrySchema.index({ userId: 1, date: -1 }, { unique: true });

AnthropometrySchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["userId"] });

module.exports = mongoose.model("Anthropometry", AnthropometrySchema);
