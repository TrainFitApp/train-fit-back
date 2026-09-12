const DAY = 86400000;

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validateTiming(input) {
  if (!validDate(input.startDate)) return "Elige una fecha de inicio válida";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || "")) return "Elige una hora válida";
  if (!["once", "daily", "weekly", "monthly"].includes(input.frequency)) return "Frecuencia no válida";
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 52) return "El intervalo debe estar entre 1 y 52";
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(); }
  catch { return "Zona horaria no válida"; }
  if (!input.timeZone) return "Indica la zona horaria";
  return null;
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}

function calendarDate(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// Fechas de calendario, no bloques de 24 h: la hora local sobrevive al cambio
// de horario. En una hora inexistente de primavera se usa la siguiente válida;
// en una hora repetida de otoño se usa la primera aparición.
function zonedInstant(date, time, timeZone) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set();
  for (const delta of [-DAY, 0, DAY]) {
    const instant = new Date(wall + delta);
    const p = localParts(instant, timeZone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime());
  }
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  for (const candidate of candidates) {
    const p = localParts(new Date(candidate), timeZone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) return new Date(candidate);
  }
  return new Date(candidates[candidates.length - 1]);
}

function occurrenceAt(schedule, index) {
  if (index < 0 || (schedule.frequency === "once" && index > 0)) return null;
  const start = new Date(`${schedule.startDate}T00:00:00Z`);
  let date;
  if (schedule.frequency === "monthly") {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index * schedule.interval, 1));
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    date = month;
  } else {
    const days = schedule.frequency === "weekly" ? 7 : 1;
    date = new Date(start.getTime() + index * schedule.interval * days * DAY);
  }
  return zonedInstant(date.toISOString().slice(0, 10), schedule.time, schedule.timeZone);
}

function occurrencesBetween(schedule, from, to, limit = 400) {
  const result = [];
  const days = Math.floor((new Date(from) - new Date(schedule.startDate)) / DAY);
  let index = schedule.frequency === "monthly"
    ? Math.max(0, Math.floor(days / (31 * schedule.interval)) - 1)
    : schedule.frequency === "once" ? 0 : Math.max(0, Math.floor(days / ((schedule.frequency === "weekly" ? 7 : 1) * schedule.interval)) - 1);
  for (; result.length < limit; index++) {
    const at = occurrenceAt(schedule, index);
    if (!at || at > new Date(to)) break;
    if (at >= new Date(from)) result.push({ at, next: occurrenceAt(schedule, index + 1), index });
  }
  return result;
}

function nextOccurrence(schedule, after) {
  return occurrencesBetween(schedule, new Date(new Date(after).getTime() + 1), new Date(new Date(after).getTime() + 1700 * DAY), 1)[0]?.at || null;
}

module.exports = { validDate, validateTiming, calendarDate, zonedInstant, occurrenceAt, occurrencesBetween, nextOccurrence };
