const { addDaysToIsoDate } = require("../util/period-util");

// Tarea 4 (2026-09) — proyección de la rutina sobre el calendario real.
// Puro: sin BD, sin await, mismo estilo que training-service.js, pero
// módulo aparte porque es un concepto distinto — esto proyecta lo
// PREVISTO (a partir de la estructura de la rutina), no agrega lo YA
// HECHO (eso sigue siendo training-service.js).
//
// El orden es el mismo que ya mantiene el fan-out de creación de filas
// (addWorkoutsToSplits) y reorderWorkoutRows: splits[] en su orden de
// array, workouts[] de cada split en su orden de array. No hace falta
// ningún campo de orden nuevo — aplanar en ESE orden y numerar desde 0 es
// la única fuente de verdad de "qué día de la rutina es esto".
function projectSchedule(startDate, splits) {
  const flattened = (splits || []).flatMap((split) => split.workouts || []);
  return flattened.map((workout, index) => ({
    date: addDaysToIsoDate(startDate, index),
    workoutId: String(workout._id),
    name: workout.name,
    isPlannedRestDay: !!workout.isPlannedRestDay,
  }));
}

function projectionInRange(startDate, splits, from, to) {
  return projectSchedule(startDate, splits).filter((row) => row.date >= from && row.date <= to);
}

// 2026-09 — "cuándo se acabaría esta fase", para el tab Entrenamiento de
// Plan. Mismo mecanismo que ya usa la adherencia (routine-assignment-
// schedule.js#computeWindowedTrainingProgress): projectSchedule aplana
// TODOS los splits de la tabla en una sola sesión por día empezando en
// startDate — el ÚLTIMO día de esa proyección es, por definición, cuando se
// completaría la rutina entera una vez, al ritmo con el que está montada.
//
// Es una ESTIMACIÓN de planificación, no una fecha real: RoutineAssignment
// sigue sin endDate propio (una fase rige hasta que otra la sustituye, ver
// routine-assignment.model.ts en el frontend) — esto no cambia eso, solo
// calcula "si entrena un día tras otro sin saltarse ninguno, ¿cuándo
// tocaría el último día de la tabla?". null si la tabla no tiene ningún
// entrenamiento.
function getProjectedPhaseEndDate(startDate, splits) {
  const schedule = projectSchedule(startDate, splits);
  if (!schedule.length) return null;
  return schedule[schedule.length - 1].date;
}

module.exports = { projectSchedule, projectionInRange, getProjectedPhaseEndDate };
