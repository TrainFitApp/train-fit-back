const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");

const CheckinTemplateDefinitionSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true },
  enabledFields: {
    type: [String],
    default: [],
    validate: {
      validator: (fields) => fields.every((f) => CHECKIN_FIELD_KEYS.includes(f)),
      message: "Campo de check-in no reconocido en el catálogo",
    },
  },
  // coach-tab FASE2 — "once" es una plantilla de una sola vez (nunca vuelve
  // a estar pendiente tras la primera respuesta), "biweekly" cada 14 días.
  cadence: { type: String, enum: ["weekly", "biweekly", "once"], default: "weekly" },
  createdAt: { type: Date, default: Date.now },
}, { collection: "checkintemplatedefinitions" });

// No dos plantillas con el mismo nombre para el mismo profesional.
CheckinTemplateDefinitionSchema.index({ trainerId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CheckinTemplateDefinition", CheckinTemplateDefinitionSchema);
