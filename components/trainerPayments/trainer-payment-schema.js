const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Agenda/libro MANUAL de cobros: el cliente paga al profesional FUERA de la
// app (Bizum, transferencia, efectivo). Esta colección NUNCA mueve dinero
// real, cero integración con pasarelas de pago.
//
// Cada documento es un COBRO (obligación concreta): puntual o generado por la
// cuota recurrente. Los pagos registrados van embebidos en el propio documento
// para que registrar un pago, corregirlo o anular el saldo sea UNA escritura
// atómica (compare-and-swap por `revision`, ver trainer-payment-dao.js#casWrite),
// sin transacciones. La lógica vive en src/*.ts (núcleo puro); aquí solo la
// forma persistida.

const METHODS = ["bizum", "transfer", "cash", "card_external", "other", "unknown"];

const MovementSchema = new Schema(
  {
    amountCents: { type: Number, required: true },
    receivedDay: { type: String, required: true }, // día civil real de recepción
    // marked_paid: cobro anterior al libro de pagos, el día es cuándo se marcó pagado.
    receivedDaySource: { type: String, enum: ["entered", "marked_paid"], required: true },
    method: { type: String, enum: METHODS, required: true },
    note: { type: String, maxlength: 500, default: null }, // privada del entrenador
    recordedAt: { type: Date, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    source: { type: String, enum: ["app", "migration"], required: true },
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

const TrainerPaymentSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  origin: { type: String, enum: ["one_off", "recurring"], required: true },
  concept: { type: String, trim: true, maxlength: 80, default: null }, // público
  note: { type: String, trim: true, maxlength: 500, default: null }, // privada del entrenador
  currency: { type: String, default: "EUR" },
  dueDay: { type: String, required: true }, // día civil "YYYY-MM-DD"
  amountCents: { type: Number, required: true },
  originalAmountCents: { type: Number, required: true },
  receivedCents: { type: Number, default: 0 },
  cancelledCents: { type: Number, default: 0 },
  status: { type: String, enum: ["open", "settled", "cancelled", "void"], required: true },
  settledAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, enum: ["plan_paused", "plan_ended", "plan_rescheduled", "relation_ended", null], default: null },
  historical: { type: Boolean, default: false },
  manualOverride: { type: Boolean, default: false },
  planOccurrenceKey: { type: String },
  planSegment: { type: Number },
  payments: { type: [MovementSchema], default: () => [] },
  adjustments: { type: [AdjustmentSchema], default: () => [] },
  operations: { type: [OperationSchema], default: () => [] },
  revision: { type: Number, required: true },
  dueRevision: { type: Number, required: true },
  remindersFrom: { type: Date, required: true },
  reminderLog: { type: [ReminderLogSchema], default: () => [] },
  createOperationId: { type: String },
  createPayloadHash: { type: String },
  // Datos dudosos de un cobro convertido (importe, fecha): la app avisa de revisarlos.
  anomalies: { type: [String], default: undefined },
  createdAt: { type: Date, default: Date.now },
}, { collection: "trainerpayments" });

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

// Borrado de cuenta: los cobros se borran con cualquiera de las dos cuentas
// (decisión vigente; la baja de una relación los conserva). Ver README.md.
TrainerPaymentSchema.plugin(require("../util/account-cascade").accountCascade, {
  owners: ["trainerId", "clientId"],
  authorship: ["payments.recordedBy", "payments.voidedBy", "adjustments.by"],
});

module.exports = mongoose.model("TrainerPayment", TrainerPaymentSchema);
