const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");
const { CustomCheckinQuestionSchema } = require("./checkin-custom-question");

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
  // Fase 5 Coach Pro — preguntas propias del coach (§7), con tipo. Conviven
  // con enabledFields, que sigue siendo el catálogo cerrado — ver
  // checkin-custom-question.js para por qué son dos cosas distintas.
  customQuestions: { type: [CustomCheckinQuestionSchema], default: () => [] },
  createdAt: { type: Date, default: Date.now },
}, { collection: "checkintemplatedefinitions" });

// No dos plantillas con el mismo nombre para el mismo profesional.
CheckinTemplateDefinitionSchema.index({ trainerId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CheckinTemplateDefinition", CheckinTemplateDefinitionSchema);
