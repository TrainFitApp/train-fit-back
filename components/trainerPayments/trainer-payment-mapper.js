const mongoose = require("mongoose");

// Frontera documento Mongo ↔ tipos del núcleo (src/types.ts): el núcleo solo
// ve ids como string y nunca un ObjectId.
const { ObjectId } = mongoose.Types;
const str = (value) => (value === null || value === undefined ? null : String(value));
const toOid = (value) => (value === null || value === undefined ? null : new ObjectId(String(value)));

function toChargeRecord(doc) {
  return {
    id: String(doc._id),
    trainerId: String(doc.trainerId),
    clientId: String(doc.clientId),
    currency: doc.currency,
    note: doc.note,
    createdAt: doc.createdAt,
    origin: doc.origin,
    concept: doc.concept,
    dueDay: doc.dueDay,
    amountCents: doc.amountCents,
    originalAmountCents: doc.originalAmountCents,
    receivedCents: doc.receivedCents,
    cancelledCents: doc.cancelledCents,
    status: doc.status,
    settledAt: doc.settledAt,
    cancelledAt: doc.cancelledAt,
    voidedAt: doc.voidedAt,
    voidReason: doc.voidReason,
    historical: doc.historical,
    manualOverride: doc.manualOverride,
    planOccurrenceKey: doc.planOccurrenceKey,
    planSegment: doc.planSegment,
    payments: doc.payments
      ? doc.payments.map((movement) => ({
          id: String(movement._id),
          amountCents: movement.amountCents,
          receivedDay: movement.receivedDay,
          receivedDaySource: movement.receivedDaySource,
          method: movement.method,
          note: movement.note ?? null,
          recordedAt: movement.recordedAt ?? null,
          recordedBy: str(movement.recordedBy),
          source: movement.source,
          operationId: movement.operationId,
          payloadHash: movement.payloadHash ?? null,
          status: movement.status,
          voidedAt: movement.voidedAt ?? null,
          voidedBy: str(movement.voidedBy),
          voidReason: movement.voidReason ?? null,
          correctionOf: str(movement.correctionOf),
        }))
      : doc.payments,
    adjustments: doc.adjustments
      ? doc.adjustments.map((item) => ({
          id: String(item._id),
          type: item.type,
          at: item.at,
          by: str(item.by),
          reason: item.reason ?? null,
          from: item.from ?? null,
          to: item.to ?? null,
          operationId: item.operationId ?? null,
        }))
      : doc.adjustments,
    operations: doc.operations
      ? doc.operations.map((op) => ({ operationId: op.operationId, kind: op.kind, payloadHash: op.payloadHash, at: op.at }))
      : doc.operations,
    revision: doc.revision,
    dueRevision: doc.dueRevision,
    remindersFrom: doc.remindersFrom,
    reminderLog: doc.reminderLog
      ? doc.reminderLog.map((entry) => ({
          key: entry.key,
          recipient: entry.recipient,
          dueRevision: entry.dueRevision,
          offset: entry.offset,
          state: entry.state,
          at: entry.at,
        }))
      : doc.reminderLog,
    anomalies: doc.anomalies,
  };
}

function movementToDoc(movement) {
  return {
    _id: toOid(movement.id),
    amountCents: movement.amountCents,
    receivedDay: movement.receivedDay,
    receivedDaySource: movement.receivedDaySource,
    method: movement.method,
    note: movement.note,
    recordedAt: movement.recordedAt,
    recordedBy: toOid(movement.recordedBy),
    source: movement.source,
    operationId: movement.operationId,
    payloadHash: movement.payloadHash,
    status: movement.status,
    voidedAt: movement.voidedAt,
    voidedBy: toOid(movement.voidedBy),
    voidReason: movement.voidReason,
    correctionOf: toOid(movement.correctionOf),
  };
}

function adjustmentToDoc(item) {
  return {
    _id: toOid(item.id),
    type: item.type,
    at: item.at,
    by: toOid(item.by),
    reason: item.reason,
    from: item.from,
    to: item.to,
    operationId: item.operationId,
  };
}

// Campos que escribe una operación del entrenador. `reminderLog` NO va aquí:
// es de los avisos (trainer-payment-reminder-service.js) y una escritura
// basada en una lectura antigua no debe pisarlo.
function chargeToSet(charge) {
  const set = {
    origin: charge.origin,
    concept: charge.concept,
    note: charge.note,
    currency: charge.currency,
    dueDay: charge.dueDay,
    amountCents: charge.amountCents,
    originalAmountCents: charge.originalAmountCents,
    receivedCents: charge.receivedCents,
    cancelledCents: charge.cancelledCents,
    status: charge.status,
    settledAt: charge.settledAt,
    cancelledAt: charge.cancelledAt,
    voidedAt: charge.voidedAt,
    voidReason: charge.voidReason,
    historical: charge.historical,
    manualOverride: charge.manualOverride,
    planOccurrenceKey: charge.planOccurrenceKey ?? undefined,
    planSegment: charge.planSegment ?? undefined,
    payments: charge.payments.map(movementToDoc),
    adjustments: charge.adjustments.map(adjustmentToDoc),
    operations: charge.operations,
    revision: charge.revision,
    dueRevision: charge.dueRevision,
    remindersFrom: charge.remindersFrom,
    anomalies: charge.anomalies,
  };
  for (const key of Object.keys(set)) if (set[key] === undefined) delete set[key];
  return set;
}

// Documento completo de un cobro nuevo (puntual o de la cuota).
function newChargeDoc(charge, extra = {}) {
  return {
    _id: toOid(charge.id),
    trainerId: toOid(charge.trainerId),
    clientId: toOid(charge.clientId),
    createdAt: charge.createdAt,
    ...chargeToSet(charge),
    reminderLog: [],
    ...extra,
  };
}

function emptyProfile(trainerId, clientId) {
  return {
    id: "",
    trainerId: String(trainerId),
    clientId: String(clientId),
    plan: null,
    clientReminders: { enabled: false, enabledAt: null, disabledAt: null, disabledReason: null },
    reminderOffsets: null,
    operations: [],
    revision: 0,
  };
}

function toProfile(doc, trainerId, clientId) {
  if (!doc) return emptyProfile(trainerId, clientId);
  const plan = doc.plan
    ? {
        status: doc.plan.status,
        concept: doc.plan.concept,
        currency: "EUR",
        unit: doc.plan.unit,
        interval: doc.plan.interval,
        anchorDay: doc.plan.anchorDay,
        segment: doc.plan.segment,
        prices: (doc.plan.prices || []).map((entry) => ({
          fromDay: entry.fromDay,
          amountCents: entry.amountCents,
          at: entry.at,
          by: str(entry.by),
        })),
        materializedThrough: doc.plan.materializedThrough ?? null,
        startedAt: doc.plan.startedAt,
        pausedAt: doc.plan.pausedAt ?? null,
        endedAt: doc.plan.endedAt ?? null,
        endReason: doc.plan.endReason ?? null,
        history: (doc.plan.history || []).map((entry) => ({
          at: entry.at,
          by: str(entry.by),
          action: entry.action,
          details: entry.details || {},
        })),
      }
    : null;
  return {
    id: String(doc._id),
    trainerId: String(doc.trainerId),
    clientId: String(doc.clientId),
    plan,
    clientReminders: {
      enabled: Boolean(doc.clientReminders?.enabled),
      enabledAt: doc.clientReminders?.enabledAt ?? null,
      disabledAt: doc.clientReminders?.disabledAt ?? null,
      disabledReason: doc.clientReminders?.disabledReason ?? null,
    },
    reminderOffsets: Array.isArray(doc.reminderOffsets) ? doc.reminderOffsets : null,
    operations: (doc.operations || []).map((op) => ({
      operationId: op.operationId,
      kind: op.kind,
      payloadHash: op.payloadHash,
      at: op.at,
    })),
    revision: doc.revision ?? 0,
  };
}

function profileToSet(profile) {
  return {
    plan: profile.plan
      ? {
          ...profile.plan,
          prices: profile.plan.prices.map((entry) => ({ ...entry, by: toOid(entry.by) })),
          history: profile.plan.history.map((entry) => ({ ...entry, by: toOid(entry.by) })),
        }
      : null,
    clientReminders: profile.clientReminders,
    reminderOffsets: profile.reminderOffsets,
    operations: profile.operations,
    revision: profile.revision,
  };
}

module.exports = {
  str,
  toOid,
  toChargeRecord,
  chargeToSet,
  newChargeDoc,
  toProfile,
  profileToSet,
  emptyProfile,
};
