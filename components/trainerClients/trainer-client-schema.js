const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TrainerClientSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // clientId queda AUSENTE del documento (nunca `null` explícito) hasta que el
    // invitado acepta y se resuelve a un usuario real — ver modelos-de-datos/01-trainerclient.md.
    clientId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    clientEmail: { type: String, required: true, trim: true, lowercase: true },
    scope: {
      type: String,
      enum: ["training", "nutrition"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "revoked", "declined"],
      default: "pending",
      index: true,
    },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // `null` debe estar en la lista del enum explícitamente — Mongoose no
    // exime automáticamente el default:null de la validación de enum.
    revokedBy: { type: String, enum: ["trainer", "client", null], default: null },
  },
  { collection: "trainerclients" }
);

// Evita invitaciones duplicadas del mismo profesional al mismo email para el mismo
// ámbito MIENTRAS estén pendientes o activas — permite reinvitar tras un revoked/declined.
TrainerClientSchema.index(
  { trainerId: 1, clientEmail: 1, scope: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "active"] } } }
);

// Acelera la consulta más frecuente de todas (requireActiveClient).
TrainerClientSchema.index({ trainerId: 1, clientId: 1, status: 1 });

module.exports = mongoose.model("TrainerClient", TrainerClientSchema);
