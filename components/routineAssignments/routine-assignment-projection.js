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

module.exports = { projectSchedule, projectionInRange };
