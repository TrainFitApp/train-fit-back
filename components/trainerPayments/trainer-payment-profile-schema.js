const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Perfil de cobro de UNA pareja entrenador–cliente (índice único), sea cual
// sea el número de scopes (training/nutrition) o de reinvitaciones: aquí
// viven la cuota recurrente (una sola) y la preferencia de avisos del cliente.
// Reinvitar no la reactiva: el documento sigue siendo el mismo.

const PriceSchema = new Schema(
  {
    fromDay: { type: String, required: true },
    amountCents: { type: Number, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const PlanHistorySchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const PlanSchema = new Schema(
  {
    status: { type: String, enum: ["active", "paused", "ended"], required: true },
    concept: { type: String, trim: true, maxlength: 80, required: true },
    currency: { type: String, default: "EUR" },
    unit: { type: String, enum: ["week", "month"], required: true },
    interval: { type: Number, required: true },
    anchorDay: { type: String, required: true },
    segment: { type: Number, required: true },
    prices: { type: [PriceSchema], default: [] },
    materializedThrough: { type: String, default: null },
    startedAt: { type: Date, required: true },
    pausedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: { type: String, enum: ["trainer", "relation_ended", null], default: null },
    history: { type: [PlanHistorySchema], default: [] },
  },
  { _id: false }
);

const OperationSchema = new Schema(
  {
    operationId: { type: String, required: true },
    kind: { type: String, required: true },
    payloadHash: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const TrainerPaymentProfileSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plan: { type: PlanSchema, default: null },
    // Avisos al cliente: DESACTIVADOS por defecto (también al migrar o reinvitar).
    clientReminders: {
      enabled: { type: Boolean, default: false },
      enabledAt: { type: Date, default: null },
      disabledAt: { type: Date, default: null },
      disabledReason: { type: String, enum: ["trainer", "relation_ended", null], default: null },
    },
    // null = hereda los hitos del entrenador (trainer-payment-settings-schema.js).
    reminderOffsets: { type: Schema.Types.Mixed, default: null },
    operations: { type: [OperationSchema], default: [] },
    revision: { type: Number, default: 0 },
  },
  { collection: "trainerpaymentprofiles", timestamps: true }
);

TrainerPaymentProfileSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });
TrainerPaymentProfileSchema.index({ clientId: 1 }); // puesta al día del cliente

TrainerPaymentProfileSchema.plugin(require("../util/account-cascade").accountCascade, {
  owners: ["trainerId", "clientId"],
  authorship: ["plan.prices.by", "plan.history.by"],
});

module.exports = mongoose.model("TrainerPaymentProfile", TrainerPaymentProfileSchema);
