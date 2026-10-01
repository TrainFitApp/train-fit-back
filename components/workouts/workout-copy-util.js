// Estado de EJECUCIÓN de una sesión concreta: no forma parte de la rutina y
// nunca debe heredarlo la copia (duplicar microciclo, duplicar fila, copiar
// a otra semana). Sin esto, una sesión saltada (`rest`) o ya hecha aparecía
// igual en el microciclo nuevo. `isPlannedRestDay` sí se copia: es descanso
// pautado por el entrenador, parte de la rutina.
function clearWorkoutExecutionState(workout) {
  delete workout.date;
  delete workout.startedAt;
  delete workout.paused;
  delete workout.cronometer;
  delete workout.rest;
  delete workout.readinessPre;
  delete workout.perceivedEffortPost;
  delete workout.sorenessPre;
}

module.exports = { clearWorkoutExecutionState };
