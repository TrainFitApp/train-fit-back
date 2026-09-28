const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const {
  MUSCLE_IDS,
  ROLE_IDS,
  normalizeMuscles,
  toLegacyMuscleGroups,
  fromLegacyMuscleGroups,
} = require("./muscle-catalog");

// Músculo implicado y cuánto cuenta (ver muscle-catalog.js). Sin _id: es un
// valor del ejercicio, no una entidad con vida propia.
const ExerciseMuscleSchema = new Schema(
  {
    muscle: { type: String, enum: MUSCLE_IDS, required: true },
    role: { type: String, enum: ROLE_IDS, required: true },
  },
  { _id: false },
);

const ExerciseSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  videoUrl: String,
  description: { type: String, trim: true, maxlength: 6500 },
  // Fuente de verdad desde 2026-09. `default: undefined` distingue "aún sin
  // migrar" (campo ausente) de "no trabaja ningún músculo" ([], cardio).
  muscles: { type: [ExerciseMuscleSchema], default: undefined },
  // Proyección de `muscles` para quien aún lee el modelo antiguo (buscador,
  // app cliente, progreso). No se editan a mano: los recalcula el hook de
  // abajo y exercise-dao.js#updateExercise.
  muscleGroups1: [String],
  muscleGroups2: [String],
  category: [String],
  equipment: [String],
  keywords: [String],
  isCardio: Boolean,
  isIsometric: Boolean,
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
});

// Cubre create, save e insertMany (el Planner crea ejercicios propios con
// insertMany/create desde workout-dao.js). Un alta que llega con `muscles`
// recalcula la proyección antigua; una que solo trae el modelo antiguo (la
// app cliente sigue usándolo) se traduce a `muscles` para que el análisis
// del Planner también la cuente.
ExerciseSchema.pre("validate", function (next) {
  if (Array.isArray(this.muscles) && (this.isNew || this.isModified("muscles"))) {
    const muscles = normalizeMuscles(this.muscles);
    const { muscleGroups1, muscleGroups2 } = toLegacyMuscleGroups(muscles);
    this.muscles = muscles;
    this.muscleGroups1 = muscleGroups1;
    this.muscleGroups2 = muscleGroups2;
  } else if (this.isNew && !this.muscles) {
    const { muscles } = fromLegacyMuscleGroups(this.muscleGroups1, this.muscleGroups2);
    if (muscles.length) this.muscles = muscles;
  }
  next();
});

ExerciseSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const exercise = await this.model.findOne(query);

    if (!exercise) return next();

    // 1. Array de favoritos (archivedExercises) en User
    try {
      const UserModel = mongoose.model("User");
      await UserModel.updateMany(
        { archivedExercises: exercise._id },
        { $pull: { archivedExercises: exercise._id } },
      );
    } catch (e) {
      console.warn(
        "UserModel not initialized or error updating user archivedExercises",
        e,
      );
    }

    // 2. Buscar customExercises enlazados a este exercise
    const customExercises = await customExerciseSchema
      .find({
        exercise: exercise._id,
      })
      .lean();

    if (customExercises.length > 0) {
      const customExerciseIds = customExercises.map((ce) => ce._id);

      // 3. Borrar los IDs de los customExercises de todos los Workouts
      try {
        const WorkoutModel = mongoose.model("Workout");
        await WorkoutModel.updateMany(
          { exercises: { $in: customExerciseIds } },
          { $pull: { exercises: { $in: customExerciseIds } } },
        );
      } catch (e) {
        console.warn(
          "WorkoutModel not initialized or error updating workouts",
          e,
        );
      }

      // 4. Borrar los customExercises de la DB
      await customExerciseSchema.deleteMany({
        _id: { $in: customExerciseIds },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Exercise", ExerciseSchema);
