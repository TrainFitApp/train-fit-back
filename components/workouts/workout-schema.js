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

const WorkoutSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 500 },
  date: Date,
  order: Number,
  cronometer: Number,
  date: Date,
  paused: Boolean,
  // Timestamp of the first "play" of this workout instance. Elapsed time is
  // always derived as (date ?? now) - startedAt, never accumulated server-side.
  startedAt: Date,
  rest: Boolean,
  // MVP-trainers F18 — pulso de readiness/esfuerzo por sesión, opcionales, no
  // configurables (a diferencia del catálogo togglable de F17). Visibles para
  // el profesional junto al historial de entrenamientos del cliente (F09).
  readinessPre: { type: Number, min: 1, max: 5, default: null },
  perceivedEffortPost: { type: Number, min: 1, max: 5, default: null },
  blocks: { type: [WorkoutBlockSchema], default: [] },
  exercises: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomExercise",
      autopopulate: true
    },
  ],
});

WorkoutSchema.plugin(require('mongoose-autopopulate'));

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
