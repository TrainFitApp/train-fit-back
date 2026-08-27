const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const setSchema = require("../sets/set-schema");

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
  // Movimiento 2 Coach Pro — `notes` pasa a ser LA NOTA DEL ENTRENADOR: la
  // indicación que acompaña al ejercicio ("baja el peso y busca profundidad").
  //
  // Hasta ahora este campo era de los dos, y el último en escribir borraba lo
  // del otro: el entrenador dejaba una corrección, el cliente apuntaba encima
  // que le dolió el hombro, y la corrección desaparecía sin rastro.
  //
  // NO se migra nada: lo que ya hubiera aquí escrito por un cliente se queda
  // donde está y se sigue leyendo, solo que bajo la etiqueta del entrenador.
  // Renombrar el campo o repartir su contenido exigiría adivinar quién
  // escribió cada nota, y no hay dato que lo diga.
  notes: { type: String, trim: true, maxlength: 500 },
  // La nota que escribe EL CLIENTE durante la sesión ("me molestó el hombro
  // en la última serie"). Campo aparte para que ninguno de los dos pise al
  // otro, y para que el entrenador sepa siempre quién dijo qué.
  clientNotes: { type: String, trim: true, maxlength: 500 },
  // Rediseño de entrenamiento Fase B — apunta al _id de un elemento de
  // Workout.blocks[] (subdocumento del Workout padre, no una colección
  // separada, por eso no lleva `ref`). null/ausente = ejercicio suelto, sin
  // agrupar.
  blockId: { type: Schema.Types.ObjectId, default: null },
  // workoutId: {
  //   type: Schema.Types.ObjectId,
  //   ref: "Workout",
  // },
});

CustomExerciseSchema.plugin(require("mongoose-autopopulate"));

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
