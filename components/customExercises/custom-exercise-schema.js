const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const setSchema = require("../sets/set-schema");
const {
  LIMITS,
  stringField,
  applyRunValidators,
} = require("../util/validation-limits");

const CustomExerciseSchema = Schema({
  sets: [
    {
      type: Schema.Types.ObjectId,
      ref: "Set",
      autopopulate: true,
    },
  ],
  order: Number,
  exercise: {
    type: Schema.Types.ObjectId,
    ref: "Exercise",
    autopopulate: true,
  },
  notes: stringField(LIMITS.text.noteMax),
  // workoutId: {
  //   type: Schema.Types.ObjectId,
  //   ref: "Workout",
  // },
});

CustomExerciseSchema.plugin(require("mongoose-autopopulate"));
applyRunValidators(CustomExerciseSchema);

CustomExerciseSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const workout = await this.model.findOne(query);
    await setSchema.deleteMany({ _id: { $in: workout.sets } });
    next();
  } catch (error) {
    next(error);
  }
});

CustomExerciseSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const customExercisesToDelete = await this.model.find(filter, "sets");
    const setIds = customExercisesToDelete.flatMap((customExercise) => customExercise.sets);
    await setSchema.deleteMany({ _id: { $in: setIds } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("CustomExercise", CustomExerciseSchema);
