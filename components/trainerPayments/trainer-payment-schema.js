const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// MVP-trainers F26 — agenda/ledger MANUAL de cobros: el cliente paga al
// profesional FUERA de la app (Bizum, transferencia, efectivo). Esta
// colección NUNCA mueve dinero real, cero integración con pasarelas de pago.
const TrainerPaymentSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: "EUR" },
  dueDate: { type: Date, required: true },
  paidAt: { type: Date, default: null },
  note: { type: String, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
}, { collection: "trainerpayments" });

TrainerPaymentSchema.index({ trainerId: 1, clientId: 1, dueDate: -1 });

module.exports = mongoose.model("TrainerPayment", TrainerPaymentSchema);
