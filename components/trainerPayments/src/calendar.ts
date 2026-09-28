import { CivilDay, PaymentsError, RecurrenceUnit, TimeOfDay } from "./types";

// PURO — días civiles "YYYY-MM-DD" y zonas IANA sin dependencias. La
// aritmética de días se hace en UTC (sin horas), así que nunca se corre un
// día por el desfase del servidor; la zona solo interviene para saber qué
// día es "hoy" y a qué instante corresponde la hora de un aviso.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const MS_PER_DAY = 86_400_000;

export const DEFAULT_TIME_ZONE = "Europe/Madrid";

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

function split(day: CivilDay): [number, number, number] {
  const match = DAY_RE.exec(day);
  if (!match) throw new PaymentsError("INVALID_DATE", `Fecha no válida: ${day}`, 400);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function formatDay(year: number, month: number, day: number): CivilDay {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isCivilDay(value: unknown): value is CivilDay {
  if (typeof value !== "string") return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= 1970 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseCivilDay(value: unknown, field: string): CivilDay {
  if (!isCivilDay(value)) {
    throw new PaymentsError("INVALID_DATE", `La fecha (${field}) no es válida: usa AAAA-MM-DD.`, 400, { field });
  }
  return value;
}

function toUtcMs(day: CivilDay): number {
  const [year, month, date] = split(day);
  return Date.UTC(year, month - 1, date);
}

export function addDays(day: CivilDay, delta: number): CivilDay {
  return new Date(toUtcMs(day) + delta * MS_PER_DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: CivilDay, to: CivilDay): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

// Siempre desde el ancla original: el 31 de enero + 1 mes = 28/29 de febrero,
// y + 2 meses = 31 de marzo (el día corto no "arrastra" a los siguientes).
export function addMonthsClamped(anchor: CivilDay, months: number): CivilDay {
  const [year, month, day] = split(anchor);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = (((total % 12) + 12) % 12) + 1;
  return formatDay(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function monthOf(day: CivilDay): string {
  return day.slice(0, 7);
}

export function maxDay(a: CivilDay | null, b: CivilDay | null): CivilDay | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

// --- Recurrencia -----------------------------------------------------------

export interface Recurrence {
  unit: RecurrenceUnit;
  interval: number;
  anchorDay: CivilDay;
}

export const INTERVAL_LIMITS: Record<RecurrenceUnit, { min: number; max: number }> = {
  week: { min: 1, max: 52 },
  month: { min: 1, max: 24 },
};

export function validateRecurrence(unit: unknown, interval: unknown, anchorDay: unknown): Recurrence {
  if (unit !== "week" && unit !== "month") {
    throw new PaymentsError("INVALID_FREQUENCY", "La frecuencia debe ser cada N semanas o cada N meses.", 400);
  }
  const limits = INTERVAL_LIMITS[unit];
  const value = Number(interval);
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw new PaymentsError(
      "INVALID_FREQUENCY",
      unit === "week"
        ? `Cada cuántas semanas: entre ${limits.min} y ${limits.max}.`
        : `Cada cuántos meses: entre ${limits.min} y ${limits.max}.`,
      400,
    );
  }
  return { unit, interval: value, anchorDay: parseCivilDay(anchorDay, "vencimiento") };
}

export function occurrenceAt(rule: Recurrence, index: number): CivilDay {
  return rule.unit === "week"
    ? addDays(rule.anchorDay, index * 7 * rule.interval)
    : addMonthsClamped(rule.anchorDay, index * rule.interval);
}

function firstIndexOnOrAfter(rule: Recurrence, day: CivilDay): number {
  if (day <= rule.anchorDay) return 0;
  if (rule.unit === "week") return Math.ceil(daysBetween(rule.anchorDay, day) / (7 * rule.interval));
  const [anchorYear, anchorMonth] = split(rule.anchorDay);
  const [year, month] = split(day);
  let index = Math.max(0, Math.floor(((year - anchorYear) * 12 + (month - anchorMonth)) / rule.interval) - 1);
  while (occurrenceAt(rule, index) < day) index += 1;
  return index;
}

export interface Occurrence {
  index: number;
  day: CivilDay;
}

// Inclusivo en ambos extremos. Acotado: el llamador pasa siempre un rango corto.
export function occurrencesBetween(rule: Recurrence, from: CivilDay, to: CivilDay): Occurrence[] {
  const result: Occurrence[] = [];
  for (let index = firstIndexOnOrAfter(rule, from); result.length < 400; index += 1) {
    const day = occurrenceAt(rule, index);
    if (day > to) break;
    result.push({ index, day });
  }
  return result;
}

export function nextOccurrences(rule: Recurrence, from: CivilDay, count: number): Occurrence[] {
  const start = firstIndexOnOrAfter(rule, from);
  return Array.from({ length: count }, (_, offset) => ({ index: start + offset, day: occurrenceAt(rule, start + offset) }));
}

export function isOccurrence(rule: Recurrence, day: CivilDay): boolean {
  return occurrenceAt(rule, firstIndexOnOrAfter(rule, day)) === day;
}

// --- Zona horaria ------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

// Solo nombres IANA ("Europe/Madrid", "UTC"): los desfases fijos (+01:00) no
// siguen los cambios de hora y romperían la hora local de los avisos.
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !ZONE_RE.test(value)) return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values["year"] ?? 1970,
    month: values["month"] ?? 1,
    day: values["day"] ?? 1,
    hour: values["hour"] ?? 0,
    minute: values["minute"] ?? 0,
    second: values["second"] ?? 0,
  };
}

export function civilDayInZone(instant: Date, timeZone: string): CivilDay {
  const parts = zonedParts(instant, timeZone);
  return formatDay(parts.year, parts.month, parts.day);
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function parseTimeOfDay(value: unknown, field = "hora"): TimeOfDay {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new PaymentsError("INVALID_TIME", `La ${field} debe tener el formato HH:mm.`, 400, { field });
  }
  return value;
}

// Instante en que el reloj de `timeZone` marca `time` el día `day`. Resuelve
// el cambio de hora: una hora inexistente (salto de primavera) cae después
// del salto, nunca antes.
export function instantForZonedTime(day: CivilDay, time: TimeOfDay, timeZone: string): Date {
  const [year, month, date] = split(day);
  const [hour, minute] = parseTimeOfDay(time).split(":").map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, date, hour, minute);
  const firstOffset = offsetMs(new Date(guess), timeZone);
  let instant = guess - firstOffset;
  const secondOffset = offsetMs(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;
  return new Date(instant);
}
