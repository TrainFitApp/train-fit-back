const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { ANTHROPOMETRY_REQUEST_FIELD_KEYS } = require("./anthropometry-request-fields");

// Petición de medidas de un trainer a un cliente — cadencia propia,
// independiente de la del check-in de bienestar (ver trainer-checkin-
// template-schema.js): un cliente puede tener cintura/peso pedidos cada
// semana y un check-in de bienestar cada 15 días sin que uno pise al otro.
const AnthropometryRequestSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  fields: {
    type: [String],
    default: [],
    validate: {
      validator: (fields) => fields.length > 0 && fields.every((f) => ANTHROPOMETRY_REQUEST_FIELD_KEYS.includes(f)),
      message: "fields debe tener al menos una medida del catálogo de antropometría",
    },
  },
  notes: { type: String, default: "" },
  cadence: { type: String, enum: ["once", "daily", "weekly", "monthly", "custom"], default: "once" },
  // Solo se usa (y se exige, ver dao) cuando cadence === "custom".
  customIntervalDays: { type: Number, default: null },
  // "once" pasa a false en cuanto el cliente manda cualquier medida; las
  // recurrentes se quedan en true hasta que el trainer las cancela.
  active: { type: Boolean, default: true },
  lastRequestedAt: { type: Date, default: Date.now },
  lastFulfilledAt: { type: Date, default: null },
  lastReminderSentAt: { type: Date, default: null },
}, { collection: "anthropometryrequests", timestamps: true });

// Un trainer solo tiene UNA petición de medidas activa por cliente — pedir
// de nuevo sustituye la anterior (mismo documento, upsert), igual que
// TrainerCheckinTemplate.
AnthropometryRequestSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model("AnthropometryRequest", AnthropometryRequestSchema);
