// Fechas de las solicitudes de check-in. TODO en "YYYY-MM-DD" + "HH:mm", sin
// zona horaria (docs/plan-semanas.md §10): la hora que fija el entrenador
// es hora de reloj, la misma para cualquier cliente esté donde esté — las
// 08:00 llegan en algún momento en todo el mundo. Antes cada programación
// guardaba un IANA time zone y las ocurrencias se materializaban como
// instantes UTC; eso obligaba a preguntar al entrenador una zona que no era
// suya sino del cliente, y a recalcular instantes cuando cambiaba.
//
// PURO: entran strings de fecha, salen strings de fecha. Ningún Date de
// reloj dentro (el "hoy" se pasa siempre desde fuera).

const { addDaysToIsoDate } = require("../util/date-util");

const FREQUENCIES = ["once", "daily", "weekly", "monthly"];

function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateTiming(input) {
  if (!validDate(input?.startDate)) return "Elige una fecha de inicio válida";
  if (!validTime(input?.time)) return "Elige una hora válida";
  if (!FREQUENCIES.includes(input?.frequency)) return "Frecuencia no válida";
  if (!Number.isInteger(input?.interval) || input.interval < 1 || input.interval > 52) {
    return "El intervalo debe estar entre 1 y 52";
  }
  return null;
}

// Día de la ocurrencia `index` (0 = la primera). null cuando no existe:
// "once" solo tiene la 0.
function occurrenceDate(schedule, index) {
  if (!validDate(schedule?.startDate) || index < 0) return null;
  if (schedule.frequency === "once") return index === 0 ? schedule.startDate : null;
  const interval = Number(schedule.interval) || 1;
  if (schedule.frequency === "monthly") {
    const start = new Date(`${schedule.startDate}T00:00:00.000Z`);
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index * interval, 1));
    // Un 31 en un mes de 30 cae en su último día, no se desborda al siguiente.
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    return month.toISOString().slice(0, 10);
  }
  const step = schedule.frequency === "weekly" ? 7 : 1;
  return addDaysToIsoDate(schedule.startDate, index * interval * step);
}

/**
 * Ocurrencias cuya fecha cae en [from, to]. Cada una con la fecha de la
 * SIGUIENTE (`next`), que es lo que cierra su ventana: una solicitud está
 * abierta desde su día hasta la víspera de la siguiente.
 */
function occurrenceDatesBetween(schedule, from, to, limit = 400) {
  if (!validDate(schedule?.startDate) || !validDate(from) || !validDate(to) || from > to) return [];
  const out = [];
  for (let index = firstIndexOnOrBefore(schedule, from); out.length < limit; index++) {
    const date = occurrenceDate(schedule, index);
    if (!date || date > to) break;
    if (date >= from) out.push({ index, date, next: occurrenceDate(schedule, index + 1) });
  }
  return out;
}

// Por dónde empezar a iterar sin recorrer desde la primera ocurrencia: una
// estimación siempre a la baja (nunca se salta ninguna).
function firstIndexOnOrBefore(schedule, from) {
  if (schedule.frequency === "once" || from <= schedule.startDate) return 0;
  const interval = Number(schedule.interval) || 1;
  const days = Math.floor((Date.parse(from) - Date.parse(schedule.startDate)) / 86400000);
  const step = schedule.frequency === "monthly" ? 31 : schedule.frequency === "weekly" ? 7 : 1;
  return Math.max(0, Math.floor(days / (step * interval)) - 1);
}

/** La ocurrencia cuya ventana contiene `date`, o null si aún no ha empezado. */
function occurrenceCovering(schedule, date) {
  if (!validDate(schedule?.startDate) || !validDate(date) || date < schedule.startDate) return null;
  let found = null;
  for (let index = firstIndexOnOrBefore(schedule, date); index < 100000; index++) {
    const at = occurrenceDate(schedule, index);
    if (!at) break;
    if (at > date) break;
    found = { index, date: at, next: occurrenceDate(schedule, index + 1) };
  }
  return found;
}

/**
 * Una página del histórico de una programación, de la ocurrencia más
 * reciente a la más antigua. Pensada para un panel que baja hacia atrás sin
 * fin: se recorre por ÍNDICE hacia abajo, así que el coste es el de la
 * página y no el de la vida de la programación — occurrenceDatesBetween no
 * sirve aquí porque exige rango y corta a las 400 (una programación diaria
 * de dos años lo pasa).
 *
 * @param {string|null} before cursor EXCLUSIVO: solo ocurrencias anteriores
 * @returns {{occurrences:{index,date,next}[], nextBefore:string|null, total:number}}
 */
function historyOccurrences(schedule, { before = null, limit = 50, today } = {}) {
  const vacio = { occurrences: [], nextBefore: null, total: 0 };
  if (!validDate(schedule?.startDate) || !validDate(today)) return vacio;
  if (before && !validDate(before)) return vacio;

  // Nunca se enseña el futuro: el histórico es lo que ya se pidió.
  const anchor = before ? addDaysToIsoDate(before, -1) : today;
  const covering = occurrenceCovering(schedule, anchor > today ? today : anchor);
  if (!covering) return vacio;

  const occurrences = [];
  for (let index = covering.index; index >= 0 && occurrences.length < limit; index--) {
    occurrences.push({ index, date: occurrenceDate(schedule, index), next: occurrenceDate(schedule, index + 1) });
  }
  const oldest = occurrences[occurrences.length - 1];
  const last = before ? occurrenceCovering(schedule, today) : covering;
  return {
    occurrences,
    nextBefore: oldest.index > 0 ? oldest.date : null,
    total: last ? last.index + 1 : 0,
  };
}

module.exports = {
  FREQUENCIES,
  validDate,
  validTime,
  validateTiming,
  occurrenceDate,
  occurrenceDatesBetween,
  occurrenceCovering,
  historyOccurrences,
};
