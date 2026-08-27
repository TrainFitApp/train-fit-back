const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const workoutSchema = require("../workouts/workout-schema");

// Movimiento 6 Coach Pro — qué es este microciclo dentro del plan.
//
// Un bloque de acumulación, uno de intensificación y una descarga se leen y
// se juzgan de forma distinta: un volumen que baja un 40% es una alarma en
// el primero y exactamente lo previsto en la tercera. Sin esto, la
// comparación bloque a bloque (Movimiento 3) no sabe distinguirlas y el
// entrenador tampoco lo ve al abrir el planificador semanas después.
//
// "regular" por defecto: todos los microciclos que ya existen lo son, y
// nadie tiene que ir a marcarlos.
const SPLIT_PURPOSES = [
  { key: "regular", label: "Normal" },
  { key: "accumulation", label: "Acumulación" },
  { key: "intensification", label: "Intensificación" },
  { key: "peak", label: "Pico" },
  { key: "deload", label: "Descarga" },
  { key: "vacation", label: "Vacaciones" },
];

const SplitSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  // Movimiento 6 Coach Pro — el objetivo del bloque, escrito por el
  // entrenador ("subir series de espalda sin tocar pierna"). Es lo que
  // responde, tres meses después, a "¿qué buscaba yo con esto?".
  objective: { type: String, trim: true, maxlength: 300, default: "" },
  purpose: {
    type: String,
    enum: SPLIT_PURPOSES.map((option) => option.key),
    default: "regular",
  },
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
    // Busca los documentos de Table que cumplen con el filtro y obtén los _id de las divisiones
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

const SplitModel = mongoose.model("Split", SplitSchema);

// El catálogo viaja con el modelo para que la interfaz no mantenga su propia
// lista de propósitos — mismo criterio que el resto de catálogos cerrados
// del proyecto (dolor, agujetas, momentos de suplemento).
SplitModel.SPLIT_PURPOSES = SPLIT_PURPOSES;

module.exports = SplitModel;
