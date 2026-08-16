const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");

// Configuración YA APLICADA a un cliente concreto — copia/snapshot
// independiente de la CheckinTemplateDefinition en el momento de aplicar,
// nunca una referencia viva (permite personalizar por cliente sin afectar
// la plantilla maestra ni a otros clientes — funcionalidad 10).
const TrainerCheckinTemplateSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  enabledFields: {
    type: [String],
    default: [],
    validate: {
      validator: (fields) => fields.every((f) => CHECKIN_FIELD_KEYS.includes(f)),
      message: "Campo de check-in no reconocido en el catálogo",
    },
  },
  cadence: { type: String, enum: ["weekly", "biweekly", "once"], default: "weekly" },
  // Informativo únicamente ("aplicado desde: X") — nunca se lee para
  // resolver el contenido real.
  sourceTemplateId: {
    type: Schema.Types.ObjectId,
    ref: "CheckinTemplateDefinition",
    default: null,
  },
  updatedAt: { type: Date, default: Date.now },
  // Última vez que se envió un recordatorio para este ciclo — evita
  // reenviar si el cron corre más de una vez el mismo día.
  lastReminderSentAt: { type: Date, default: null },
});

// Un trainer solo tiene UNA configuración aplicada por cliente — aplicar una
// plantilla nueva sustituye la anterior (mismo documento, upsert).
TrainerCheckinTemplateSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("TrainerCheckinTemplate", TrainerCheckinTemplateSchema);
