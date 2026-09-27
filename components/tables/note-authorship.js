// PURO — autoría de las notas de entrenamiento (2026-09). Workout.notes /
// clientNotes y PinnedExerciseNote no guardan quién escribió: se deduce de
// quién pide. El dueño de la tabla es el cliente; cualquier otro con acceso
// (entrenador con relación "training", admin) escribe como entrenador.

function noteAuthorRole(requesterId, ownerUserId) {
  return String(requesterId) === String(ownerUserId) ? "client" : "trainer";
}

// Campos de nota que quien pide no puede tocar en modifyWorkout. El front
// manda el workout entero con la copia que tenga en memoria, así que sin
// esto cada guardado pisaría la nota del otro:
// - el cliente no pisa la indicación del entrenador en una rutina asignada
//   (sin entrenador, `notes` es suya y la sigue escribiendo);
// - el entrenador nunca pisa la nota del cliente.
function stripForeignWorkoutNotes(body, { authorRole, trainerManaged }) {
  const clean = { ...body };
  if (authorRole === "client" && trainerManaged) delete clean.notes;
  if (authorRole === "trainer") delete clean.clientNotes;
  return clean;
}

// Una nota anclada por posición es única: cada uno solo edita o borra la
// suya. Las anteriores a authorRole (null) las puede tocar cualquiera.
function canWritePinnedNote(existing, authorRole) {
  return !existing || !existing.authorRole || existing.authorRole === authorRole;
}

module.exports = { noteAuthorRole, stripForeignWorkoutNotes, canWritePinnedNote };
