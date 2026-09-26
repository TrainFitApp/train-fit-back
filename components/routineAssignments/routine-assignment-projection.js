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
//
// microcycleNumber (2026-09): posición 1-based del split en la tabla, para
// el badge "M1, M2…" del calendario de entrenamiento — reinicia en cada
// fase porque cada fase proyecta su propia tabla desde el split 0.
function projectSchedule(startDate, splits) {
  const flattened = (splits || []).flatMap((split, splitIndex) =>
    (split.workouts || []).map((workout) => ({ workout, microcycleNumber: splitIndex + 1 }))
  );
  return flattened.map(({ workout, microcycleNumber }, index) => ({
    date: addDaysToIsoDate(startDate, index),
    workoutId: String(workout._id),
    name: workout.name,
    isPlannedRestDay: !!workout.isPlannedRestDay,
    microcycleNumber,
  }));
}

function projectionInRange(startDate, splits, from, to) {
  return projectSchedule(startDate, splits).filter((row) => row.date >= from && row.date <= to);
}

// Fase A2 (2026-09) — igual que projectionInRange pero para VARIAS fases
// encadenadas, no solo "la activa". El controlador de /active/schedule
// proyectaba SIEMPRE la fase marcada "active" en BD sobre el rango entero
// pedido — y una fase FUTURA ya se marca "active" en cuanto se crea (ver
// routine-assignment-service.js#applyRoutine), así que programar la
// siguiente fase hacía que TODO el calendario, incluidos los días que
// siguen rigiendo la fase anterior hasta que la nueva empiece de verdad, se
// pintara con la tabla nueva. Aquí cada fase se recorta a la ventana que de
// verdad gobierna: desde su propio startDate hasta el startDate de la
// siguiente (o hasta `to` si es la última dentro del rango pedido). Las
// fases no se solapan nunca (applyRoutine ya lo impide), así que no hace
// falta reconciliar huecos ni colisiones aquí.
function projectionAcrossAssignments(assignments, tableById, from, to) {
  const ordered = [...assignments].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const rows = [];

  ordered.forEach((assignment, index) => {
    const table = tableById.get(String(assignment.tableId));
    if (!table) return;

    const next = ordered[index + 1];
    const phaseFrom = assignment.startDate > from ? assignment.startDate : from;
    const phaseTo = next && next.startDate <= to ? addDaysToIsoDate(next.startDate, -1) : to;
    if (phaseFrom > phaseTo) return;

    const phaseRows = projectionInRange(assignment.startDate, table.splits, phaseFrom, phaseTo).map((row) => ({
      ...row,
      // Identidad de la fase que produjo este día — el frontend la usa para
      // colorear el calendario por FASE (mismo color que ya usa en las
      // tarjetas de "Fases de entrenamiento"), no adivinándola cruzando
      // workoutId contra una sola tabla como antes.
      assignmentId: String(assignment._id),
    }));
    rows.push(...phaseRows);
  });

  return rows;
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

module.exports = { projectSchedule, projectionInRange, projectionAcrossAssignments, getProjectedPhaseEndDate };
