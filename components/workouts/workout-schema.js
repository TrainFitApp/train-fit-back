const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const customExerciseSchema = require("../customExercises/custom-exercise-schema");

// Rediseño de entrenamiento Fase B (sesión 2026-08-09) — bloques/superseries
// reintroducidos, esta vez consumidos de verdad en current-workout.page.html
// (cliente real) Y workout.component.html (editor real del entrenador) en la
// misma pasada. `blocks[]` son solo metadata de agrupación (nombre, tipo,
// rondas, descansos) — las exercises[] ya existen como CustomExercise
// independientes; cada una apunta a un bloque vía CustomExercise.blockId
// (ObjectId de un elemento de este array, NO una colección separada).
const WorkoutBlockSchema = Schema({
  name: { type: String, trim: true, maxlength: 100, default: "" },
  type: {
    type: String,
    enum: ["straight", "superset", "circuit", "warmup", "finisher"],
    default: "straight",
  },
  order: { type: Number, default: 0 },
  rounds: { type: Number, default: null },
  restBetweenExercises: { type: Number, default: null },
  restBetweenRounds: { type: Number, default: null },
  instructions: { type: String, trim: true, maxlength: 500, default: "" },
});

// Movimiento 2 Coach Pro — agujetas al llegar a la sesión, por grupo
// muscular. Solo se guardan los grupos que el cliente marca por encima de
// "nada": ver sanitizeSoreness en soreness-catalog.js, que es también donde
// está explicado por qué se pregunta al empezar y no al terminar.
const WorkoutSorenessSchema = Schema(
  {
    muscle: { type: String, required: true },
    level: { type: Number, min: 1, max: 5, required: true },
  },
  { _id: false }
);

const WorkoutSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  // 2026-09 — mismo reparto que CustomExercise.notes/clientNotes: `notes` es
  // la indicación de quien construye la rutina (el entrenador si la tabla
  // está asignada) y `clientNotes` lo que apunta el cliente al entrenar. Las
  // notas anteriores a la separación se quedan en `notes`.
  notes: { type: String, trim: true, maxlength: 500 },
  clientNotes: { type: String, trim: true, maxlength: 500 },
  date: Date,
  order: Number,
  cronometer: Number,
  date: Date,
  paused: Boolean,
  // Timestamp of the first "play" of this workout instance. Elapsed time is
  // always derived as (date ?? now) - startedAt, never accumulated server-side.
  startedAt: Date,
  rest: Boolean,
  // Tarea 4 (2026-09) — descanso PAUTADO por el entrenador al construir la
  // rutina, distinto de `rest` (que es el cliente saltando esta sesión en
  // ejecución). Un microciclo con esta fila marcada nunca la ofrece como
  // sesión a hacer; se inserta con el mismo mecanismo de "añadir día" que
  // cualquier otra fila (misma fila en todos los microciclos a la vez), así
  // que nunca desalinea el conteo de filas entre microciclos.
  isPlannedRestDay: { type: Boolean, default: false },
  // MVP-trainers F18 — pulso de readiness/esfuerzo por sesión, opcionales, no
  // configurables (a diferencia del catálogo togglable de F17). Visibles para
  // el profesional junto al historial de entrenamientos del cliente (F09).
  readinessPre: { type: Number, min: 1, max: 5, default: null },
  perceivedEffortPost: { type: Number, min: 1, max: 5, default: null },
  // Movimiento 2 Coach Pro — se recoge en el MISMO aviso que readinessPre
  // ("¿cómo llegas hoy?"), no en uno nuevo. Vacío = nada reportado.
  sorenessPre: { type: [WorkoutSorenessSchema], default: [] },
  blocks: { type: [WorkoutBlockSchema], default: [] },
  exercises: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomExercise",
      autopopulate: true
    },
  ],
  // Unificación workoutTemplates -> workouts (2026-08) — un Workout con
  // trainerId es una plantilla suelta del profesional (sin Split que lo
  // referencie), nunca un workout real de cliente. Único discriminador: si
  // en el futuro hace falta "quién asignó este workout" (provenance sobre un
  // workout SÍ vinculado a un split, mismo patrón que Meal.assignedByTrainerId),
  // eso es un campo nuevo y distinto — trainerId nunca se reutiliza para dos
  // significados.
  trainerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  // Solo con sentido para plantillas (trainerId set); en workouts reales
  // quedan en su default y no se usan.
  description: { type: String, trim: true, maxlength: 500, default: "" },
  level: {
    type: String,
    enum: ["principiante", "intermedio", "avanzado"],
    default: "intermedio",
  },
  tags: { type: [String], default: [] },
  equipment: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

WorkoutSchema.plugin(require('mongoose-autopopulate'));

// Guardarraíl: toda query BROAD de Workout (sin _id ni trainerId propios)
// excluye plantillas (trainerId set) por defecto — así un listado/stats
// nuevo nunca las cuela por olvido. Una consulta por _id concreto (findById,
// findByIdAndUpdate, incluso $in con ids ya conocidos) o que ya filtra por
// trainerId explícito no se toca: ya está scopeada a un documento/dueño
// concreto, forzar trainerId:null ahí rompería ese caso en vez de proteger
// nada (mismo criterio en meals/meal-schema.js).
WorkoutSchema.pre(/^find/, function (next) {
  const query = this.getQuery();
  if (query._id === undefined && query.trainerId === undefined) {
    this.where({ trainerId: null });
  }
  next();
});

WorkoutSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const workout = await this.model.findOne(query);
    await customExerciseSchema.deleteMany({ _id: { $in: workout.exercises } });
    next();
  } catch (error) {
    next(error);
  }
});

WorkoutSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const workoutsToDelete = await this.model.find(filter, "exercises");
    const customExerciseIds = workoutsToDelete.flatMap((workout) => workout.exercises);
    await customExerciseSchema.deleteMany({ _id: { $in: customExerciseIds } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Workout", WorkoutSchema);
