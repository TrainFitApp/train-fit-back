const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const customExerciseSchema = require("../customExercises/custom-exercise-schema");


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
