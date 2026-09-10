const crypto = require("crypto");
const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

const DAY = 86400000;
const FIELDS = CHECKIN_FIELDS.filter((field) => field.storage === "anthropometry");
const PERIMETERS = FIELDS.filter((field) => field.group === "perimetros")
  .map((field) => ({ key: field.anthropometryField, label: field.label, unit: field.unit }));

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

function civilToday(timeZone = "UTC", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone) ? timeZone : "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name) => parts.find((item) => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date, count) {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + count * DAY).toISOString().slice(0, 10);
}

function weekStart(date) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

function naturalWeeks(today, count = 8) {
  if (!validDate(today)) throw new Error("Invalid civil date");
  const weeks = Math.max(1, Math.min(52, Number.isInteger(count) ? count : 8));
  const monday = weekStart(today);
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(monday, (index - weeks + 1) * 7);
    const end = addDays(start, 6);
    return { start, end, partial: end >= today };
  });
}

function validMeasurement(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

function canonicalEntries(entries, today) {
  // Un día cuenta una sola vez. La colección tiene índice único usuario/fecha.
  const days = new Map();
  for (const entry of entries || []) {
    if (!validDate(entry.date) || entry.date > today) continue;
    const existing = days.get(entry.date) || { date: entry.date };
    for (const field of FIELDS) {
      const key = field.anthropometryField;
      if (validMeasurement(entry[key])) existing[key] = entry[key];
    }
    if (entry._id) existing._id = String(entry._id);
    days.set(entry.date, existing);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function metric(entries, baselines, key) {
  const baseline = baselines.find((item) => item.key === key && validDate(item.date) && validMeasurement(item.value));
  const initial = baseline || null;
  const latest = [...entries].reverse().find((entry) => validMeasurement(entry[key]));
  const last = latest ? { value: latest[key], date: latest.date, sourceId: latest._id || null } : null;
  let baselineStatus = initial ? "valid" : "missing";
  if (initial?.sourceId) {
    const source = entries.find((entry) => String(entry._id) === String(initial.sourceId));
    if (!source || !validMeasurement(source[key])) baselineStatus = "source_missing";
    else if (source.date !== initial.date || source[key] !== initial.value) baselineStatus = "source_changed";
  }
  return {
    initial, last,
    // No comparar una referencia reciente contra un último registro anterior.
    delta: initial && last && last.date >= initial.date && baselineStatus === "valid" ? round(last.value - initial.value) : null,
    baselineStatus,
  };
}

function buildBodyMetrics(entries = [], baselines = [], options = {}) {
  const today = options.today || civilToday(options.timeZone);
  if (!validDate(today)) throw new Error("Invalid civil date");
  const rows = canonicalEntries(entries, today);
  const weekly = naturalWeeks(today, options.weeks).map((week) => {
    const values = rows.filter((row) => row.date >= week.start && row.date <= week.end && validMeasurement(row.weight))
      .map((row) => row.weight);
    return { ...week, average: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null, count: values.length };
  });
  const selected = new Set((options.highlightedPerimeters || []).slice(0, 3));
  return {
    today,
    weight: { ...metric(rows, baselines, "weight"), weekly },
    perimeters: PERIMETERS.filter((field) => selected.has(field.key)).map((field) => ({ ...field, ...metric(rows, baselines, field.key) })),
    availablePerimeters: PERIMETERS,
    latestMeasuredOn: [...rows].reverse().find((row) => FIELDS.some((field) => validMeasurement(row[field.anthropometryField])))?.date || null,
  };
}

function observationFingerprint(entries = []) {
  // Incluir también altas retrospectivas y borrados; la fecha máxima no basta.
  const normalized = entries.map((row) => {
    const values = {};
    for (const field of FIELDS) {
      const value = row[field.anthropometryField];
      if (typeof value === "number" && Number.isFinite(value)) values[field.anthropometryField] = value;
    }
    return { id: String(row._id || ""), date: row.date, values };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

module.exports = { buildBodyMetrics, naturalWeeks, weekStart, addDays, civilToday, validDate, validTimeZone, validMeasurement, observationFingerprint };
