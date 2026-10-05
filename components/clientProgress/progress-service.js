const { CHECKIN_FIELDS_BY_KEY } = require("../trainerCheckins/checkin-field-catalog");
const dietDaysNutritionUtil = require("../dietDays/diet-days-nutrition-util");

// Fase 2 Coach Pro — reparto en SEMANAS de todo lo que un cliente genera, y
// la comparativa entre las dos últimas.
//
// Ventanas de 7 días rodantes que terminan HOY, no semanas naturales de
// lunes a domingo. Con semanas naturales, un martes la "semana actual" tiene
// 2 días y su adherencia se compara contra los 7 de la anterior: el cliente
// parece haberse hundido cada lunes y recuperado cada domingo. La ventana
// rodante compara siempre 7 días contra 7 días.
//
// Puro: entran datos ya cargados, salen los buckets. Sin BD.

// Campos de bienestar que se promedian por semana. Salen del catálogo de
// check-in (misma fuente que usa el resto de la app) filtrando los
// numéricos: los de composición corporal y perímetros ya se leen de
// Anthropometry, y `comment` es texto. No hay lista propia que mantener —
// si mañana se añade un campo numérico al catálogo, aparece aquí solo.
const WELLBEING_NUMERIC_KEYS = [...CHECKIN_FIELDS_BY_KEY.values()]
  .filter((f) => f.storage === "wellbeing" && f.type !== "text")
  .map((f) => f.key);

// Perímetros que se siguen semana a semana. Mismo criterio de reutilización
// del catálogo que coach-signals-service.js#TRACKED_PERIMETERS.
const PERIMETER_FIELDS = [...CHECKIN_FIELDS_BY_KEY.values()]
  .filter((f) => f.group === "perimetros" && f.anthropometryField)
  .map((f) => ({ key: f.anthropometryField, label: f.label }));

const { isoDateInZone, addDaysToIsoDate } = require("../util/date-util");

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value, decimals = 1) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Ventanas de 7 días, de la más antigua a la más reciente. La última termina
 * hoy — el hoy del CLIENTE, en su zona horaria (`timeZone`). `weeks` es
 * cuántas se piden (4, 8 o 12 según lo que mire el coach).
 */
function buildWeekWindows(weeks, now, timeZone) {
  const today = isoDateInZone(now, timeZone);
  const windows = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDaysToIsoDate(today, -i * 7);
    windows.push({ start: addDaysToIsoDate(end, -6), end });
  }
  return windows;
}

function inWindow(dateStr, window) {
  return dateStr >= window.start && dateStr <= window.end;
}

/** Peso de una semana: media, nº de pesajes y último valor registrado. */
function weekWeight(entries, window) {
  const inWeek = entries.filter(
    (e) => typeof e.weight === "number" && Number.isFinite(e.weight) && inWindow(e.date, window)
  );
  if (!inWeek.length) return null;
  return {
    // La media es más fiable que un pesaje suelto: absorbe la variación
    // diaria de agua/glucógeno que hace que dos lunes seguidos parezcan
    // decir cosas opuestas.
    average: round(average(inWeek.map((e) => e.weight)), 2),
    last: inWeek[inWeek.length - 1].weight,
    count: inWeek.length,
  };
}

/** Perímetros de una semana: el ÚLTIMO valor de cada uno (no la media —
 *  una medida con cinta no se promedia, se compara punto a punto). */
function weekMeasurements(entries, window) {
  const inWeek = entries.filter((e) => inWindow(e.date, window));
  if (!inWeek.length) return null;

  const result = {};
  for (const field of PERIMETER_FIELDS) {
    for (let i = inWeek.length - 1; i >= 0; i--) {
      const value = inWeek[i][field.key];
      if (typeof value === "number" && Number.isFinite(value)) {
        result[field.key] = value;
        break;
      }
    }
  }
  return Object.keys(result).length ? result : null;
}

/** Bienestar de una semana: media de cada campo numérico reportado. */
function weekWellbeing(responses, window, timeZone) {
  const inWeek = responses.filter((r) => inWindow(isoDateInZone(r.respondedAt, timeZone), window));
  if (!inWeek.length) return null;

  const result = {};
  for (const key of WELLBEING_NUMERIC_KEYS) {
    const values = inWeek
      .map((r) => Number(r.values?.[key]))
      .filter((v) => Number.isFinite(v));
    if (values.length) result[key] = round(average(values), 1);
  }
  return Object.keys(result).length ? result : null;
}

/** Adherencia nutricional de una semana, con la misma aritmética que el
 *  resto del sistema (computeRangeAdherence), aplicada a 7 días. */
function weekNutrition(dietDays, window) {
  const inWeek = dietDays.filter((d) => inWindow(d.date, window));
  const result = dietDaysNutritionUtil.computeRangeAdherence(inWeek, 7);
  return result.daysWithData ? result.percentage : null;
}

function weekSessions(workoutDates, window, timeZone) {
  return workoutDates.filter((d) => inWindow(isoDateInZone(d, timeZone), window)).length;
}

function weekHabits(completions, activeTaskCount, window) {
  if (!activeTaskCount) return null;
  const done = completions.filter((c) => inWindow(c.date, window)).length;
  return Math.min(100, Math.round((done / (activeTaskCount * 7)) * 100));
}

/**
 * Serie semanal completa. Cada semana lleva `null` en lo que no tenga datos
 * — nunca 0, que el frontend pintaría como "cumplió cero" en vez de "no
 * reportó".
 */
function buildWeeklySeries({
  weeks,
  now,
  // Zona horaria del cliente: sus sesiones y check-ins (instantes) caen en
  // el día de SU calendario.
  timeZone,
  anthropometryEntries = [],
  checkinResponses = [],
  dietDays = [],
  workoutDates = [],
  taskCompletions = [],
  activeTaskCount = 0,
}) {
  return buildWeekWindows(weeks, now, timeZone).map((window) => {
    const sessions = weekSessions(workoutDates, window, timeZone);
    return {
      start: window.start,
      end: window.end,
      weight: weekWeight(anthropometryEntries, window),
      measurements: weekMeasurements(anthropometryEntries, window),
      wellbeing: weekWellbeing(checkinResponses, window, timeZone),
      nutritionAdherence: weekNutrition(dietDays, window),
      // Sesiones de la semana en ABSOLUTO, sin porcentaje: convertirlo en %
      // exigía saber cuántas tocaban por semana, y eso el modelo no lo sabe
      // (`Split` no guarda duración). La versión anterior lo daba por hecho
      // dividiendo entre las sesiones del último microciclo. "3, 2, 0, 3"
      // dice más que un porcentaje calculado sobre una suposición.
      sessions,
      habitsAdherence: weekHabits(taskCompletions, activeTaskCount, window),
      checkins: checkinResponses.filter((r) => inWindow(isoDateInZone(r.respondedAt, timeZone), window)).length,
    };
  });
}

function delta(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  const absolute = round(current - previous, 2);
  return {
    current,
    previous,
    absolute,
    percentage: previous ? round((absolute / previous) * 100, 1) : null,
  };
}

/**
 * Comparativa de la última semana contra la anterior. Solo aparecen las
 * métricas que existen en AMBAS semanas: comparar contra un hueco produce
 * variaciones inventadas ("ha bajado 80 kg" porque la semana pasada no se
 * pesó).
 */
function buildComparison(series) {
  if (series.length < 2) return null;

  const current = series[series.length - 1];
  const previous = series[series.length - 2];

  const measurements = {};
  for (const field of PERIMETER_FIELDS) {
    const d = delta(current.measurements?.[field.key], previous.measurements?.[field.key]);
    if (d) measurements[field.key] = { ...d, label: field.label };
  }

  const wellbeing = {};
  for (const key of WELLBEING_NUMERIC_KEYS) {
    const d = delta(current.wellbeing?.[key], previous.wellbeing?.[key]);
    if (d) wellbeing[key] = { ...d, label: CHECKIN_FIELDS_BY_KEY.get(key)?.label || key };
  }

  return {
    period: { current: { start: current.start, end: current.end }, previous: { start: previous.start, end: previous.end } },
    weightAverage: delta(current.weight?.average, previous.weight?.average),
    nutritionAdherence: delta(current.nutritionAdherence, previous.nutritionAdherence),
    sessions: delta(current.sessions, previous.sessions),
    habitsAdherence: delta(current.habitsAdherence, previous.habitsAdherence),
    measurements: Object.keys(measurements).length ? measurements : null,
    wellbeing: Object.keys(wellbeing).length ? wellbeing : null,
  };
}

/**
 * Tendencia del peso sobre TODA la serie: primera semana con datos contra la
 * última. Responde la única pregunta que una lista de 12 números no responde
 * de un vistazo — "¿hacia dónde va esto?".
 */
function buildWeightTrend(series) {
  const withWeight = series.filter((w) => w.weight?.average !== null && w.weight !== null);
  if (withWeight.length < 2) return null;

  const first = withWeight[0];
  const last = withWeight[withWeight.length - 1];
  const absolute = round(last.weight.average - first.weight.average, 2);

  return {
    fromWeek: { start: first.start, average: first.weight.average },
    toWeek: { start: last.start, average: last.weight.average },
    absolute,
    percentage: first.weight.average ? round((absolute / first.weight.average) * 100, 2) : null,
    weeksCovered: withWeight.length,
  };
}

module.exports = {
  WELLBEING_NUMERIC_KEYS,
  PERIMETER_FIELDS,
  buildWeekWindows,
  buildWeeklySeries,
  buildComparison,
  buildWeightTrend,
};
