// PURO — lo que el CLIENTE ve de lo que le cobra un profesional (Coach > Tus
// profesionales): la cuota, el resumen y cada cobro con sus pagos (importe y
// día). Parte de las vistas del núcleo (src/dto.ts: planView,
// clientPaymentsSummary y chargeDetailView) y quita lo que es solo del
// entrenador: notas, método, quién y cuándo lo anotó, correcciones, ajustes y
// anomalías. Una previsión (cuota futura sin dinero) no sale como cobro: el
// próximo vencimiento ya va en `summary.next`.

function planForClient(plan) {
  if (!plan) return null;
  return {
    status: plan.status,
    concept: plan.concept,
    currency: plan.currency,
    unit: plan.unit,
    interval: plan.interval,
    amountCents: plan.amountCents,
    nextDueDay: plan.nextDueDay,
    scheduledPrice: plan.scheduledPrice,
    startedAt: plan.startedAt,
  };
}

function summaryForClient(summary) {
  return {
    state: summary.state,
    currency: summary.currency,
    pendingCents: summary.pendingCents,
    overdue: summary.overdue
      ? { balanceCents: summary.overdue.balanceCents, count: summary.overdue.count, oldestDueDay: summary.overdue.oldestDueDay }
      : null,
    next: summary.next ? { dueDay: summary.next.dueDay, amountCents: summary.next.amountCents } : null,
  };
}

// Pagos válidos, del más reciente al más antiguo. Los anulados o corregidos
// no cuentan en el saldo y solo confundirían.
function paymentsForClient(payments) {
  return (payments || [])
    .filter((payment) => payment.status === "valid")
    .map((payment) => ({ id: payment.id, amountCents: payment.amountCents, receivedDay: payment.receivedDay || null }))
    .sort((a, b) => String(b.receivedDay || "").localeCompare(String(a.receivedDay || "")));
}

function chargeForClient(detail) {
  return {
    id: detail.id,
    origin: detail.origin,
    concept: detail.concept,
    currency: detail.currency,
    dueDay: detail.dueDay,
    amountCents: detail.amountCents,
    receivedCents: detail.receivedCents,
    cancelledCents: detail.cancelledCents,
    balanceCents: detail.balanceCents,
    status: detail.status,
    temporal: detail.temporal,
    payments: paymentsForClient(detail.payments),
  };
}

/**
 * `plan`: planView del núcleo (o null). `summary`: clientPaymentsSummary.
 * `charges`: chargeDetailView de los cobros de la pareja, ya ordenados.
 */
function clientLedgerView({ today, plan, summary, charges }) {
  return {
    today,
    plan: planForClient(plan),
    summary: summaryForClient(summary),
    charges: (charges || []).filter((charge) => charge.status !== "void" && !charge.forecast).map(chargeForClient),
  };
}

module.exports = { clientLedgerView };
