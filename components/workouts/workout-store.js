const Workout = require("./workout-schema");
const { mutateDocument, ConcurrentUpdateError } = require("../util/embedded-store");

// Escritura de una sesión entera (2026-10). Una sesión lleva dentro sus
// ejercicios y series, y varias rutas la cambian a la vez: el cliente marca
// series mientras guarda la sesión, el entrenador reordena ejercicios… Ver
// util/embedded-store.js: compare-and-swap sobre `__v` y reintento.

class WorkoutConflictError extends ConcurrentUpdateError {
  constructor() {
    super("La sesión ha cambiado mientras se guardaba. Vuelve a intentarlo.", "WORKOUT_CONFLICT");
  }
}

/**
 * Lee la sesión que casa con `filter` (sin poblar), deja que `mutate`
 * cambie una copia y escribe los campos que devuelve. `mutate` recibe la
 * sesión en plano y devuelve un objeto `{ campo: valorNuevo }` (o null si no
 * hay nada que escribir). Devuelve la sesión ya escrita (en plano) o null si
 * no existe.
 */
async function mutateWorkout(filter, mutate) {
  return mutateDocument(Workout, filter, mutate, { onConflict: () => new WorkoutConflictError() });
}

module.exports = { mutateWorkout, WorkoutConflictError };
