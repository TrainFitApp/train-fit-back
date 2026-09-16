// Ciclos por contenido (docs/plan-ciclos-por-contenido.md) — la ventana de
// fechas de cada ciclo de una fase. No hay un documento por ciclo: solo se
// persisten los que cambian algo (el head = C1 siempre, y los que el
// entrenador prepara). Un ciclo dura lo que dura su CONTENIDO: los días de la
// dieta en `sequential`, la semana en `recurring`, lo que diga
// `choiceCycleDays` en `choice`. Las ventanas se encadenan: C(n) empieza el
// día después de que acabe C(n-1), y mide lo que mida el último ciclo
// persistido que ya había empezado en esa fecha — así un ciclo preparado con
// otro número de días cambia el paso de todos los que le siguen.
//
// PURO, sin fechas de reloj: `date` se pasa siempre desde fuera para poder
// testearlo (mismo criterio que cycle-progression.js).

const { addDaysToIsoDate } = require("../util/date-util");

const DEFAULT_CYCLE_DAYS = 7;
// Ventanas que se pueden encadenar hacia delante antes de rendirse: una fase
// de años con ciclos de un día. Solo protege de un bucle infinito por datos
// corruptos (startDate vacío), nunca debería alcanzarse.
const MAX_WINDOWS = 5000;

function normalizeCycleDays(cycleDays) {
  const n = Number(cycleDays);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_CYCLE_DAYS;
}

/** Días que dura un ciclo con este contenido. */
function contentCycleDays(doc) {
  if (!doc) return DEFAULT_CYCLE_DAYS;
  if (doc.mode === "recurring") return 7;
  if (doc.mode === "choice") return normalizeCycleDays(doc.choiceCycleDays);
  const days = Array.isArray(doc.days) ? doc.days.length : 0;
  return days >= 1 ? days : DEFAULT_CYCLE_DAYS;
}

// Ciclo persistido que rige en `date`: el último que ya había empezado.
// `cycles` ordenados por startDate ascendente (head primero).
function overrideAt(cycles, date) {
  let found = null;
  for (const c of cycles) if (c.startDate && c.startDate <= date) found = c;
  return found;
}

/**
 * Ventanas desde C1 hasta la que contiene `date` (inclusive). Una fecha
 * anterior al inicio de la fase devuelve solo C1 (la fase aún no ha
 * empezado; "el actual" es el que va a empezar).
 *
 * Cada ventana: { number, start, end, len, override } — `override` es el
 * doc persistido cuyo contenido rige en ella.
 */
function windowsUntil(cycles, date) {
  const head = cycles[0];
  if (!head?.startDate) return [];
  const windows = [];
  let start = head.startDate;
  for (let number = 1; number <= MAX_WINDOWS; number++) {
    const override = overrideAt(cycles, start) || head;
    const len = contentCycleDays(override);
    const end = addDaysToIsoDate(start, len - 1);
    windows.push({ number, start, end, len, override });
    if (date <= end) break;
    start = addDaysToIsoDate(end, 1);
  }
  return windows;
}

/** La ventana que contiene `date` (o C1 si la fase no ha empezado). */
function windowAt(cycles, date) {
  const windows = windowsUntil(cycles, date);
  return windows[windows.length - 1] || null;
}

/** La ventana que sigue a `window`. */
function nextWindow(cycles, window) {
  const start = addDaysToIsoDate(window.end, 1);
  const override = overrideAt(cycles, start) || cycles[0];
  const len = contentCycleDays(override);
  return { number: window.number + 1, start, end: addDaysToIsoDate(start, len - 1), len, override };
}

module.exports = {
  DEFAULT_CYCLE_DAYS,
  normalizeCycleDays,
  contentCycleDays,
  overrideAt,
  windowsUntil,
  windowAt,
  nextWindow,
};
