// PURO — "Guardar como plantilla" desde el Planner (2026-09): de una rutina
// de cliente solo se lleva la PAUTA. Todo lo que es ejecución (cuándo se
// hizo, lo que se levantó de verdad, cómo llegó el cliente) o autoría del
// cliente (sus notas) se queda en su rutina. Muta el documento en sitio,
// igual que normalizeSetForTemplateCopy en table-dao.js, que se sigue
// aplicando después en copyHierarchy (doned, drop, restPause, RIR de fallo).

const WORKOUT_EXECUTION_FIELDS = [
  "date",
  "cronometer",
  "paused",
  "startedAt",
  "rest",
  "readinessPre",
  "perceivedEffortPost",
  "sorenessPre",
  // Workout.notes la escriben el cliente y el entrenador indistintamente (es
  // una de las fuentes de "Notas del cliente", ver client-notes-builder.js):
  // no hay forma de saber de quién es, así que no se copia.
  "notes",
];

const CUSTOM_EXERCISE_CLIENT_FIELDS = ["clientNotes"];

// Valores REALES de una serie hecha. weight se queda: es a la vez el peso
// pautado y el levantado (no hay expectedWeight).
const SET_EXECUTION_FIELDS = [
  "reps",
  "rir",
  "donedAt",
  "cronometer",
  "time",
  "timeMin",
  "timeSec",
  "distance",
];

function omit(target, fields) {
  if (!target || typeof target !== "object") return;
  fields.forEach((field) => {
    delete target[field];
  });
}

function stripExecutionForTemplate(tableDoc) {
  (tableDoc?.splits || []).forEach((split) => {
    (split?.workouts || []).forEach((workout) => {
      omit(workout, WORKOUT_EXECUTION_FIELDS);
      (workout?.exercises || []).forEach((customExercise) => {
        omit(customExercise, CUSTOM_EXERCISE_CLIENT_FIELDS);
        (customExercise?.sets || []).forEach((set) => omit(set, SET_EXECUTION_FIELDS));
      });
    });
  });
  delete tableDoc.assignedByTrainerId;
  return tableDoc;
}

module.exports = { stripExecutionForTemplate };
