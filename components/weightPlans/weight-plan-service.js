const DAY_MS = 24 * 60 * 60 * 1000;

// Anthropometry.date es "YYYY-MM-DD", no una fecha con hora. Se ancla al
// FINAL de ese día: pesarse el martes y mirar el jueves por la mañana con
// pauta de dos días no es un incumplimiento, y anclar a las 00:00 lo haría
// parecer uno. La ventana perdona el desfase de horas, que es exactamente lo
// que se decidió al elegir ventana deslizante.
function endOfIsoDay(isoDate) {
  return new Date(`${isoDate}T23:59:59.999Z`);
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS);
}

/**
 * ¿Está esta pauta al día?
 *
 * Ventana deslizante: hay un peso dentro de los últimos `intervalDays` o no
 * lo hay. No cuenta ventanas fijas ni porcentajes — un cliente que se pesa de
 * más no debe salir peor parado, y uno que se pesa el día 4 en vez del 3 no
 * ha dejado de seguir la pauta.
 *
 * Sin ningún peso registrado todavía, la ventana cuenta desde que se creó la
 * pauta: una pauta recién puesta no puede nacer atrasada.
 */
function complianceFor(plan, lastWeight, now = new Date()) {
  if (!plan) return null;

  const anchor = lastWeight?.date ? endOfIsoDay(lastWeight.date) : new Date(plan.createdAt);
  const dueAt = addDays(anchor, plan.intervalDays);
  const upToDate = now <= dueAt;

  return {
    intervalDays: plan.intervalDays,
    notes: plan.notes || "",
    lastWeightAt: lastWeight?.date || null,
    lastWeightKg: lastWeight?.weight ?? null,
    neverWeighed: !lastWeight,
    dueAt,
    upToDate,
    // Días completos de retraso. 0 mientras esté al día — el consumidor
    // pinta "al día" o "atrasado N días" sin tener que restar fechas.
    overdueDays: upToDate ? 0 : Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS),
  };
}

/**
 * ¿Toca avisar de esta pauta?
 *
 * Un solo aviso por ventana: `lastReminderSentAt` posterior al vencimiento
 * significa que ya se avisó de ESTE, no del anterior. Sin esto, una pauta
 * vencida generaría una notificación cada día que el cron corriera.
 */
function reminderIsDue(plan, compliance, now = new Date()) {
  if (!plan || !compliance || compliance.upToDate) return false;
  if (!plan.lastReminderSentAt) return true;
  return new Date(plan.lastReminderSentAt) < compliance.dueAt;
}

module.exports = { complianceFor, reminderIsDue, addDays, endOfIsoDay };
