const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const WorkoutBase = require("./workout-base-schema");

// Agujetas al llegar a la sesión, por grupo muscular. Solo se guardan los
// grupos que el cliente marca por encima de "nada": ver sanitizeSoreness en
// soreness-catalog.js, que es también donde está explicado por qué se
// pregunta al empezar y no al terminar.
const WorkoutSorenessSchema = Schema(
  {
    muscle: { type: String, required: true },
    level: { type: Number, min: 1, max: 5, required: true },
  },
  { _id: false }
);

// Una SESIÓN de una rutina: cuelga de un microciclo (Table.splits[].workouts)
// y es lo que el cliente ejecuta. Nombre, nota, bloques y ejercicios son los
// de workout-base-schema.js; aquí, la ejecución. Las plantillas sueltas del
// profesional son otro modelo de la misma colección (WorkoutTemplate).
const WorkoutSchema = new Schema({
  // Lo que apunta el cliente al entrenar; `notes` es la indicación de quien
  // construye la rutina.
  clientNotes: { type: String, trim: true, maxlength: 500 },
  date: Date,
  order: Number,
  cronometer: Number,
  paused: Boolean,
  // Primer "play" de la sesión. El tiempo transcurrido siempre se deriva
  // como (date ?? ahora) - startedAt, nunca se acumula en el servidor.
  startedAt: Date,
  // El cliente se salta esta sesión al ejecutarla.
  rest: Boolean,
  // Descanso PAUTADO por el entrenador al construir la rutina, distinto de
  // `rest`. Un microciclo con esta fila marcada nunca la ofrece como sesión
  // a hacer; se inserta con el mismo mecanismo de "añadir día" que cualquier
  // otra fila (misma fila en todos los microciclos a la vez), así que nunca
  // desalinea el conteo de filas entre microciclos.
  isPlannedRestDay: { type: Boolean, default: false },
  // Pulso de readiness/esfuerzo por sesión, opcionales. Visibles para el
  // profesional junto al historial de entrenamientos del cliente.
  readinessPre: { type: Number, min: 1, max: 5, default: null },
  perceivedEffortPost: { type: Number, min: 1, max: 5, default: null },
  // Se recoge en el MISMO aviso que readinessPre ("¿cómo llegas hoy?").
  // Vacío = nada reportado.
  sorenessPre: { type: [WorkoutSorenessSchema], default: [] },
});

module.exports = WorkoutBase.discriminator("Workout", WorkoutSchema, "session");
