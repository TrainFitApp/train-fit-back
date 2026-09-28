// Autorrelleno de un check-in con las medidas que el cliente ya apuntó por
// su cuenta (modal de medidas, peso diario). Un check-in quincenal que pide
// cintura no obliga a medirse otra vez si ya lo hizo hace nueve días: el
// formulario sale relleno y el cliente revisa y envía. NUNCA se envía solo.
//
// PURO: entran programación, ocurrencia, "hoy" y documentos de Anthropometry;
// salen fechas y valores. Sin Mongo ni reloj.

const { CHECKIN_FIELDS_BY_KEY } = require("./checkin-field-catalog");
const { occurrenceDate } = require("./checkin-schedule-dates");
const { addDaysToIsoDate } = require("../util/date-util");

// Un "once" no tiene periodo: se mira la última semana.
const ONCE_LOOKBACK_DAYS = 7;

function periodDays(schedule) {
  const interval = Number(schedule.interval) || 1;
  if (schedule.frequency === "daily") return interval;
  if (schedule.frequency === "weekly") return 7 * interval;
  if (schedule.frequency === "monthly") return 30 * interval;
  return ONCE_LOOKBACK_DAYS;
}

/**
 * Días de los que sirven medidas: el periodo que cubre este check-in, del
 * día siguiente a la ocurrencia anterior hasta hoy. La primera ocurrencia no
 * tiene anterior: se retrocede un periodo.
 */
function prefillWindow(schedule, occurrence, today) {
  const previous =
    occurrence.index > 0
      ? occurrenceDate(schedule, occurrence.index - 1)
      : addDaysToIsoDate(occurrence.date, -periodDays(schedule));
  return { from: addDaysToIsoDate(previous, 1), to: today };
}

/**
 * Último valor de cada campo de medida pedido dentro de la ventana, cada uno
 * con su día: peso del viernes y cintura del lunes se juntan.
 * @returns {Record<string, {value:number, date:string}>}
 */
function anthropometryPrefill(enabledFields, anthropometries, { from, to }) {
  const byDateDesc = (anthropometries || [])
    .filter((a) => a?.date >= from && a.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date));
  const prefill = {};
  for (const key of enabledFields || []) {
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (field?.storage !== "anthropometry") continue;
    const found = byDateDesc.find((a) => Number.isFinite(a[field.anthropometryField]));
    if (found) prefill[key] = { value: found[field.anthropometryField], date: found.date };
  }
  return prefill;
}

/**
 * Campos de medida que hay que escribir en Anthropometry al responder: los
 * que el cliente dejó tal cual vinieron del autorrelleno ya están guardados
 * en su día, reescribirlos hoy duplicaría la medida.
 */
function changedAnthropometryFields(values, prefill) {
  const fields = {};
  for (const [key, value] of Object.entries(values || {})) {
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (field?.storage !== "anthropometry") continue;
    if (prefill?.[key] && prefill[key].value === value) continue;
    fields[field.anthropometryField] = value;
  }
  return fields;
}

module.exports = { prefillWindow, anthropometryPrefill, changedAnthropometryFields };
