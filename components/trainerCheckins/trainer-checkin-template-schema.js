const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");

// Configuración YA APLICADA a un cliente concreto — copia independiente de la
// CheckinTemplateDefinition en el momento de aplicar, nunca una referencia
// viva (ver modelos-de-datos/03-trainercheckintemplate.md, principio de copia
// profunda).
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
  // coach-tab FASE2 — "once" es una plantilla de una sola vez (nunca vuelve
  // a estar pendiente tras la primera respuesta), "biweekly" cada 14 días.
  cadence: { type: String, enum: ["weekly", "biweekly", "once"], default: "weekly" },
  // Informativo únicamente ("aplicado desde: Pro") — nunca se lee para
  // resolver el contenido real, ver modelos-de-datos/03-trainercheckintemplate.md.
  sourceTemplateId: { type: Schema.Types.ObjectId, ref: "CheckinTemplateDefinition", default: null },
  updatedAt: { type: Date, default: Date.now },
  // TASK-025 (MASTER_BACKLOG.md) — última vez que se envió un recordatorio
  // por este cadence. Evita reenviar el mismo día si el cron corre más de
  // una vez, y evita reenviar mientras el cliente sigue "al día" (se compara
  // contra la fecha en la que volvió a tocar due, no solo "hoy").
  lastReminderSentAt: { type: Date, default: null },
}, { collection: "trainercheckintemplates" });

// Un profesional solo tiene UNA configuración aplicada por cliente — aplicar
// una plantilla nueva sustituye la anterior (mismo documento, upsert).
TrainerCheckinTemplateSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("TrainerCheckinTemplate", TrainerCheckinTemplateSchema);
