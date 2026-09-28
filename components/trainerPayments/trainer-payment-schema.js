const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// MVP-trainers F26 — agenda/ledger MANUAL de cobros: el cliente paga al
// profesional FUERA de la app (Bizum, transferencia, efectivo). Esta
// colección NUNCA mueve dinero real, cero integración con pasarelas de pago.
//
// Cobros 2026-09 — cada documento es un COBRO (obligación concreta): puntual,
// generado por la cuota recurrente o antiguo. Los pagos registrados van
// embebidos en el propio documento para que registrar un pago, corregirlo o
// anular el saldo sea UNA escritura atómica (compare-and-swap por `revision`,
// ver trainer-payment-dao.js#casWrite), sin transacciones. La lógica vive en
// src/*.ts (núcleo puro); aquí solo la forma persistida.
//
// Campos antiguos (amount/currency/dueDate/paidAt/note) se conservan y se
// mantienen sincronizados para las apps anteriores: amount = amountCents/100,
// paidAt = liquidado (nunca cancelado), dueDate = mediodía UTC del día civil.
// Un documento sin `schemaVersion` es un cobro antiguo sin migrar: se lee
// normalizado (ledger.ts#normalizeCharge) y pasa a la forma nueva al escribirlo.

const METHODS = ["bizum", "transfer", "cash", "card_external", "other", "unknown"];

const MovementSchema = new Schema(
  {
    amountCents: { type: Number, required: true },
    receivedDay: { type: String, required: true }, // día civil real de recepción
    receivedDaySource: { type: String, enum: ["entered", "legacy_marked_paid"], required: true },
    method: { type: String, enum: METHODS, required: true },
    note: { type: String, maxlength: 500, default: null }, // privada del entrenador
    recordedAt: { type: Date, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    source: { type: String, enum: ["app", "legacy_toggle", "migration"], required: true },
    operationId: { type: String, required: true },
    payloadHash: { type: String, default: null },
    status: { type: String, enum: ["valid", "voided"], required: true },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, maxlength: 300, default: null },
    correctionOf: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: true }
);

const AdjustmentSchema = new Schema(
  {
    type: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, maxlength: 300, default: null },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    operationId: { type: String, default: null },
  },
  { _id: true }
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

// Hitos de aviso ya resueltos (enviados u omitidos). Lo escribe solo la puesta
// al día de avisos (trainer-payment-reminder-service.js),
// con $push condicionado, y nunca lo pisan las escrituras del entrenador.
const ReminderLogSchema = new Schema(
  {
    key: { type: String, required: true },
    recipient: { type: String, enum: ["trainer", "client"], required: true },
    dueRevision: { type: Number, required: true },
    offset: { type: Number, required: true },
    state: { type: String, enum: ["sent", "skipped"], required: true },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const LegacySchema = new Schema(
  {
    sourceAmount: { type: Number, default: null },
    sourceCurrency: { type: String, default: null },
    sourceDueDate: { type: Date, default: null },
    sourcePaidAt: { type: Date, default: null },
    dueDaySource: { type: String, default: null },
    dueDayAmbiguous: { type: Boolean, default: false },
    timeZone: { type: String, default: null },
    migratedAt: { type: Date, default: null },
    migratedBy: { type: String, default: null },
  },
  { _id: false }
);

const TrainerPaymentSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: "EUR" },
  dueDate: { type: Date, required: true },
  paidAt: { type: Date, default: null },
  note: { type: String, trim: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },

  // --- Cobros 2026-09 ---
  schemaVersion: { type: Number },
  origin: { type: String, enum: ["one_off", "recurring", "legacy"] },
  concept: { type: String, trim: true, maxlength: 80, default: null }, // público
  dueDay: { type: String },
  amountCents: { type: Number },
  originalAmountCents: { type: Number },
  receivedCents: { type: Number },
  cancelledCents: { type: Number },
  status: { type: String, enum: ["open", "settled", "cancelled", "void"] },
  settledAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, enum: ["plan_paused", "plan_ended", "plan_rescheduled", "relation_ended", null], default: null },
  historical: { type: Boolean },
  manualOverride: { type: Boolean },
  planOccurrenceKey: { type: String },
  planSegment: { type: Number },
  payments: { type: [MovementSchema], default: undefined },
  adjustments: { type: [AdjustmentSchema], default: undefined },
  operations: { type: [OperationSchema], default: undefined },
  revision: { type: Number },
  dueRevision: { type: Number },
  remindersFrom: { type: Date },
  reminderLog: { type: [ReminderLogSchema], default: undefined },
  createOperationId: { type: String },
  createPayloadHash: { type: String },
  legacy: { type: LegacySchema, default: undefined },
  anomalies: { type: [String], default: undefined },
}, { collection: "trainerpayments" });

TrainerPaymentSchema.index({ trainerId: 1, clientId: 1, dueDate: -1 });
TrainerPaymentSchema.index({ trainerId: 1, clientId: 1, dueDay: 1 });
TrainerPaymentSchema.index({ trainerId: 1, status: 1, dueDay: 1 }); // avisos y totales del entrenador
TrainerPaymentSchema.index({ clientId: 1, status: 1 }); // pendiente del Coach y avisos del cliente
// Cada vencimiento de la cuota se genera UNA vez aunque corran varios procesos.
TrainerPaymentSchema.index(
  { planOccurrenceKey: 1 },
  { unique: true, partialFilterExpression: { planOccurrenceKey: { $type: "string" } } }
);
// Alta idempotente de un cobro puntual (doble clic, reintento de red).
TrainerPaymentSchema.index(
  { trainerId: 1, createOperationId: 1 },
  { unique: true, partialFilterExpression: { createOperationId: { $type: "string" } } }
);

module.exports = mongoose.model("TrainerPayment", TrainerPaymentSchema);
