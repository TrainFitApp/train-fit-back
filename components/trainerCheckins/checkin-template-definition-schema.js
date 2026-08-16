const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");

// Plantilla MAESTRA de check-in, por trainer (funcionalidad 10).
const CheckinTemplateDefinitionSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  enabledFields: {
    type: [String],
    default: [],
    validate: {
      validator: (fields) => fields.every((f) => CHECKIN_FIELD_KEYS.includes(f)),
      message: "Campo de check-in no reconocido en el catálogo",
    },
  },
  cadence: { type: String, enum: ["weekly", "biweekly", "once"], default: "weekly" },
  createdAt: { type: Date, default: Date.now },
});

CheckinTemplateDefinitionSchema.index({ trainerId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CheckinTemplateDefinition", CheckinTemplateDefinitionSchema);
