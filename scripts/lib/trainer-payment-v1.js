// SOLO MIGRACIÓN — cobros anteriores al libro de pagos: un documento plano
// { amount (euros), currency, dueDate, paidAt, note, createdAt } por cobro.
// Se convierten a la forma de components/trainerPayments/trainer-payment-schema.js
// sin inventar precisión: lo dudoso queda en `anomalies` y la app pide revisarlo.
//
// Usa los helpers de calendario del núcleo compilado (.build/trainer-payments).

// Los cobros antiguos se crearon desde la app en España: su día civil se
// interpreta siempre en esta zona.
const V1_TIME_ZONE = "Europe/Madrid";

const validDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

function amountToCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return { cents: 0, anomaly: "invalid_amount" };
  const scaled = amount * 100;
  const rounded = Math.round(scaled);
  return { cents: rounded, anomaly: Math.abs(scaled - rounded) < 1e-6 ? null : "amount_precision" };
}

// El formulario antiguo mandaba "YYYY-MM-DD" (medianoche UTC) y los seeds
// usaban horas sueltas: no vale cortar el ISO a ciegas. Medianoche UTC o
// medianoche de Madrid son exactas; cualquier otra hora se resuelve en Madrid
// y es dudosa si el día UTC y el de Madrid no coinciden.
function dueDayOf(C, dueDate, createdAt) {
  if (!validDate(dueDate)) {
    return { day: validDate(createdAt) ? C.civilDayInZone(createdAt, V1_TIME_ZONE) : "1970-01-01", anomaly: "invalid_due_date" };
  }
  const utcDay = dueDate.toISOString().slice(0, 10);
  if (dueDate.getTime() === new Date(`${utcDay}T00:00:00.000Z`).getTime()) return { day: utcDay, anomaly: null };
  const zoneDay = C.civilDayInZone(dueDate, V1_TIME_ZONE);
  if (C.instantForZonedTime(zoneDay, "00:00", V1_TIME_ZONE).getTime() === dueDate.getTime()) return { day: zoneDay, anomaly: null };
  return { day: zoneDay, anomaly: zoneDay !== utcDay ? "ambiguous_due_date" : null };
}

/**
 * Campos del cobro nuevo para un documento antiguo. Un cobro marcado pagado
 * pasa a tener su pago equivalente: mismo importe, día en que se MARCÓ pagado
 * (`marked_paid`, no cuándo llegó el dinero), método desconocido y sin
 * fecha ni autor de anotación (nunca existieron).
 */
function convertV1(C, doc, { now }) {
  const anomalies = [];
  const { cents, anomaly } = amountToCents(doc.amount);
  if (anomaly) anomalies.push(anomaly);
  const currency = String(doc.currency || "EUR").toUpperCase();
  if (currency !== "EUR") anomalies.push("non_eur_currency");
  const due = dueDayOf(C, doc.dueDate, doc.createdAt);
  if (due.anomaly) anomalies.push(due.anomaly);
  const paidAt = validDate(doc.paidAt) ? doc.paidAt : null;
  if (doc.paidAt && !paidAt) anomalies.push("invalid_paid_at");
  const createdAt = validDate(doc.createdAt) ? doc.createdAt : paidAt || new Date(0);

  const payments =
    paidAt && cents > 0
      ? [
          {
            _id: doc._id,
            amountCents: cents,
            receivedDay: C.civilDayInZone(paidAt, V1_TIME_ZONE),
            receivedDaySource: "marked_paid",
            method: "unknown",
            note: null,
            recordedAt: null,
            recordedBy: null,
            source: "migration",
            operationId: `migrated-paid:${doc._id}`,
            payloadHash: null,
            status: "valid",
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            correctionOf: null,
          },
        ]
      : [];
  const receivedCents = payments.length ? cents : 0;
  const status = cents > 0 ? C.deriveStatus(cents, receivedCents, 0) : "open";
  return {
    origin: "one_off",
    concept: null,
    note: doc.note || null,
    currency,
    dueDay: due.day,
    amountCents: cents,
    originalAmountCents: cents,
    receivedCents,
    cancelledCents: 0,
    status,
    settledAt: status === "settled" ? paidAt : null,
    cancelledAt: null,
    voidedAt: null,
    voidReason: null,
    historical: false,
    manualOverride: false,
    payments,
    adjustments: [],
    operations: [],
    revision: 1,
    dueRevision: 1,
    // Ningún aviso por lo anterior a la conversión.
    remindersFrom: now,
    reminderLog: [],
    createdAt,
    ...(anomalies.length ? { anomalies } : {}),
  };
}

module.exports = { V1_TIME_ZONE, amountToCents, dueDayOf, convertV1 };
