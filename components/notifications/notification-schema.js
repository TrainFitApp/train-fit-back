const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Funcionalidad 15 — solo in-app, nunca push (el proyecto no tiene
// Firebase/FCM configurado). A diferencia de refactor-claude (payload:
// Mixed, copia de los datos), se guarda una referencia tipada al recurso
// real — se resuelve al mostrarla, o se usa un texto genérico por `type`
// sin necesidad de los datos completos.
const NOTIFICATION_TYPES = [
  "meal_proposed",
  "meal_pinned",
  "payment_created",
  "preferences_requested",
  "checkin_requested",
  "routine_assigned",
  "diet_assigned",
  "goal_assigned",
  "task_assigned",
  "intake_submitted",
  "intake_confirmed",
];

const NotificationSchema = new Schema({
  // Destinatario — exactamente uno de los dos según la dirección del evento
  // (trainer→cliente o cliente→trainer).
  clientId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  trainerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  resourceType: { type: String, trim: true },
  resourceId: { type: Schema.Types.ObjectId, default: null },
  read: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

NotificationSchema.statics.NOTIFICATION_TYPES = NOTIFICATION_TYPES;

module.exports = mongoose.model("Notification", NotificationSchema);
