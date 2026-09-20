// Necesidad del cliente por revisión (docs/plan-revisiones.md) — la parte
// PURA: de dónde salen los pasos que entran en la fórmula y qué forma tiene
// el snapshot del cálculo. Lo que toca BD vive en plan-assignment-service.js.

const { stepsRangeFromAverage } = require("../nutritionalGoals/training-factor");
const { daysInRange } = require("../util/date-util");

// Días marcados que hacen que la pauta de pasos cuente como real. Por debajo
// de la mitad de los días, lo que el hábito dice que anda el cliente no
// describe lo que ha andado: manda el rango de su perfil.
const MIN_COMPLETION_RATIO = 0.5;

/**
 * Pasos del cliente a partir de su HÁBITO de pasos y de los días que lo marcó
 * dentro de una revisión (docs/plan-revisiones.md §12). Los pasos no se
 * declaran en el check-in ni se teclean a diario: el profesional los pauta
 * como hábito ("10.000 a 15.000 pasos") y el cliente marca cada día si lo
 * cumplió, bajo sus comidas.
 *
 * El rango pautado se resuelve por su punto medio cuando es un rango, o por
 * el objetivo a secas cuando no lo es.
 *
 * @param {{ target:number, targetMax:number|null }|null} task hábito de pasos
 * @param {number} completedDays días marcados dentro de la ventana
 * @param {{ start:string, end:string|null }|null} window revisión mirada
 * @param {string} until último día con datos (hoy o el fin de la ventana)
 * @returns {{ key, label, target, targetMax, completedDays, windowDays }|null}
 */
function stepsFromHabit(task, completedDays = 0, window = null, until = null) {
  if (!task || !(Number(task.target) > 0)) return null;

  const start = window?.start || null;
  const end = window?.end && (!until || window.end < until) ? window.end : until;
  const windowDays = start && end ? daysInRange(start, end) : 0;
  // Sin días suficientes marcados no hay dato: el perfil sigue mandando.
  if (!windowDays || completedDays < Math.ceil(windowDays * MIN_COMPLETION_RATIO)) return null;

  const target = Number(task.target);
  const targetMax = Number(task.targetMax) > target ? Number(task.targetMax) : null;
  const range = stepsRangeFromAverage(targetMax ? (target + targetMax) / 2 : target);
  if (!range) return null;

  return {
    key: range.key,
    label: range.label,
    target,
    targetMax,
    completedDays,
    windowDays,
  };
}

/**
 * Snapshot a partir de lo que devuelve resolveClientNutritionTarget. Misma
 * forma tanto si se persiste (al empezar la fase) como si se calcula al
 * vuelo, para que el front pinte una sola cosa.
 */
function needSnapshot(resolved, computedAt = new Date()) {
  if (!resolved) return null;
  if (!resolved.ok) {
    return { computedAt, missing: resolved.missing, inputs: resolved.inputs, breakdown: null, target: null };
  }
  return {
    computedAt,
    missing: undefined,
    inputs: resolved.inputs,
    breakdown: resolved.breakdown,
    target: resolved.target,
  };
}

module.exports = { MIN_COMPLETION_RATIO, stepsFromHabit, needSnapshot };
