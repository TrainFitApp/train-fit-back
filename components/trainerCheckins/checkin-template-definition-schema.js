const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");
const { CustomQuestionSchema } = require("../forms/custom-question");

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
  // Obligatorios: subconjunto de enabledFields que el cliente no puede dejar
  // en blanco (mismo trato que `required` en una pregunta propia). Vacío =
  // todo opcional, que es como funcionaban las plantillas anteriores.
  requiredFields: {
    type: [String],
    default: [],
    validate: {
      validator: (fields) => fields.every((f) => CHECKIN_FIELD_KEYS.includes(f)),
      message: "Campo obligatorio no reconocido en el catálogo",
    },
  },
  // Sin cadencia: cada cuánto se pide un check-in lo dice la PROGRAMACIÓN de
  // cada cliente (CheckinSchedule), no la plantilla. La plantilla es solo el
  // formulario — las mismas preguntas pueden pedirse semanalmente a uno y
  // cada tres semanas a otro.
  // Fase 5 Coach Pro — preguntas propias del coach (§7), con tipo. Conviven
  // con enabledFields, que sigue siendo el catálogo cerrado — ver
  // forms/custom-question.js para por qué son dos cosas distintas.
  customQuestions: { type: [CustomQuestionSchema], default: () => [] },
  createdAt: { type: Date, default: Date.now },
}, { collection: "checkintemplatedefinitions" });

// No dos plantillas con el mismo nombre para el mismo profesional.
CheckinTemplateDefinitionSchema.index({ trainerId: 1, name: 1 }, { unique: true });

CheckinTemplateDefinitionSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"] });

module.exports = mongoose.model("CheckinTemplateDefinition", CheckinTemplateDefinitionSchema);
