const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Tab Coach, Fase 3 — centro de notificaciones in-app (nunca push remoto, ver
// 00-riesgos.md R5). Un registro por cada acción relevante que un profesional
// realiza sobre un cliente concreto (proponer comida, crear cobro, solicitar
// check-in/preferencias, asignar rutina/objetivo). También sirve de histórico
// de contenido asignado: los eventos "routine_assigned"/"goal_assigned" ya
// son, por sí mismos, el registro de qué se asignó y cuándo — no se duplica
// en una colección aparte.
const NotificationSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      required: true,
      enum: [
        "meal_proposal",
        "payment_created",
        "nutrition_preferences_requested",
        "checkin_requested",
        "routine_assigned",
        "goal_assigned",
        "task_assigned",
        "intake_submitted",
        "client_confirmed",
        "meal_prescribed",
      ],
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "notifications" }
);

// Índice principal de lectura: "mis notificaciones, más recientes primero,
// filtrando por leídas/no leídas" — el único patrón de consulta real de esta
// colección.
NotificationSchema.index({ clientId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
