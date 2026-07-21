const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const customExerciseSchema = require("../customExercises/custom-exercise-schema");

const ExerciseSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  videoUrl: String,
  description: { type: String, trim: true, maxlength: 6500 },
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
