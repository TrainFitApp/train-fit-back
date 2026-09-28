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
  checkinSources: { type: [Schema.Types.ObjectId], default: undefined, select: false },
  // Campos de este día que vienen de un check-in pedido por el entrenador:
  // el cliente no los ve en sus pantallas (anthropometry-origin.js).
  checkinFields: { type: [String], default: undefined },
  neck: { type: Number },
  chest: { type: Number },
  // Deprecados (MVP-trainers D8, 2026-08-01): un único valor histórico sin
  // lateralidad. Ya no se escriben desde el frontend actualizado, pero se
  // conservan para seguir leyendo documentos históricos — ver
  // modelos-de-datos/05-cambios-modelos-existentes.md, sección 2.2, para la
  // estrategia de migración (deliberadamente sin backfill automático).
  bicepsRelaxed: { type: Number },
  bicepsContracted: { type: Number },
  calf: { type: Number },
  waist: { type: Number },
  abdomen: { type: Number },
  hip: { type: Number },
  thighContracted: { type: Number },
  thighRelaxed: { type: Number },
  // --- MVP-trainers D8 (2026-08-01) — campos nuevos del catálogo de check-in ---
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

module.exports = AnthropometrySchema;
