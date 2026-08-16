const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SCOPES = ["training", "nutrition"];
const STATUSES = [
  "pending",
  "cuestionario_pendiente",
  "en_revision",
  "active",
  "revoked",
  "declined",
];
const NON_TERMINAL_STATUSES = [
  "pending",
  "cuestionario_pendiente",
  "en_revision",
  "active",
];

const TrainerClientSchema = new Schema({
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  // Nulo hasta que el cliente acepta (se resuelve el User por email en ese momento).
  clientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true,
  },
  clientEmail: { type: String, required: true, trim: true, lowercase: true },
  scope: { type: String, enum: SCOPES, required: true },
  status: {
    type: String,
    enum: STATUSES,
    default: "pending",
    index: true,
  },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, enum: ["trainer", "client", null], default: null },
  // Funcionalidades 11/12 — subdocumentos embebidos (no colección propia,
  // ver docs/trainfit-trainers/05-especificaciones-acordadas.md): al vivir
  // dentro de esta relación concreta, quedan separados por generación
  // automáticamente (cada revocación+reaceptación crea un TrainerClient
  // nuevo) sin ningún campo extra.
  notes: {
    type: [
      {
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        pinned: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: undefined,
  },
  payments: {
    type: [
      {
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "EUR", trim: true, maxlength: 10 },
        dueDate: { type: Date, default: null },
        paidAt: { type: Date, default: null },
        note: { type: String, trim: true, maxlength: 500 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: undefined,
  },
});

// Evita invitaciones activas duplicadas del mismo trainer al mismo email en
// el mismo ámbito. Al ser parcial (solo estados no terminales), permite
// reinvitar tras una revocación/rechazo sin chocar con el histórico.
TrainerClientSchema.index(
  { trainerId: 1, clientEmail: 1, scope: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: NON_TERMINAL_STATUSES } },
  }
);
TrainerClientSchema.index({ trainerId: 1, clientId: 1, status: 1 });

TrainerClientSchema.statics.SCOPES = SCOPES;
TrainerClientSchema.statics.STATUSES = STATUSES;
TrainerClientSchema.statics.NON_TERMINAL_STATUSES = NON_TERMINAL_STATUSES;

module.exports = mongoose.model("TrainerClient", TrainerClientSchema);
