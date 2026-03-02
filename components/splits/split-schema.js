const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const workoutSchema = require("../workouts/workout-schema");

const SplitSchema = Schema({
  name: String,
  workouts: [
    {
      type: Schema.Types.ObjectId,
      ref: "Workout",
      autopopulate: true,
    },
  ],
});

SplitSchema.plugin(require("mongoose-autopopulate"));

SplitSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const split = await this.model.findOne(query);
    await workoutSchema.deleteMany({ _id: { $in: split.workouts } });
    next();
  } catch (error) {
    next(error);
  }
});

SplitSchema.pre("deleteMany", async function (next) {
  try {
    // Obtén el filtro utilizado en la operación deleteMany
    const filter = this.getFilter();
    // Busca los documentos de OwnTable que cumplen con el filtro y obtén los _id de las divisiones
    const splitsToDelete = await this.model.find(filter, "workouts");
    // Obtén un arreglo de _id de divisiones de todos los documentos
    const workoutIds = splitsToDelete.flatMap((split) => split.workouts);
    // Elimina las divisiones relacionadas en la colección splitSchema
    await workoutSchema.deleteMany({ _id: { $in: workoutIds } });
    next();
  } catch (error) {
    // Maneja el error de manera adecuada, por ejemplo, puedes llamar a next con el error
    next(error);
  }
});

module.exports = mongoose.model("Split", SplitSchema);
