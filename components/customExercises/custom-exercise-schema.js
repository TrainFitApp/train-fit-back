const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const SetSchema = require("../sets/set-schema");
// `exercise` se autopuebla también al guardar la sesión: el modelo Exercise
// tiene que estar registrado aunque quien cargue Workout no lo haya pedido.
require("../exercises/exercise-schema");

// Un ejercicio dentro de una sesión. Desde 2026-10 vive EMBEBIDO en su
// Workout (Workout.exercises[]) con sus series dentro; antes eran dos
// colecciones (customexercises y sets) que había que poblar, copiar y borrar
// en cascada a mano. Se conserva el `_id` de cada ejercicio: las rutas
// /customexercises/:id siguen recibiendo el mismo id.
const CustomExerciseSchema = new Schema({
  exercise: {
    type: Schema.Types.ObjectId,
    ref: "Exercise",
    autopopulate: true,
  },
  order: Number,
  // `notes` es LA NOTA DEL ENTRENADOR: la indicación que acompaña al
  // ejercicio ("baja el peso y busca profundidad"). Lo que ya hubiera aquí
  // escrito por un cliente (de antes de separar las notas) se sigue leyendo
  // bajo esta etiqueta: no hay dato que diga quién escribió cada nota.
  notes: { type: String, trim: true, maxlength: 500 },
  // La nota que escribe EL CLIENTE durante la sesión ("me molestó el hombro
  // en la última serie"). Campo aparte para que ninguno de los dos pise al
  // otro, y para que el entrenador sepa siempre quién dijo qué.
  clientNotes: { type: String, trim: true, maxlength: 500 },
  // Apunta al _id de un elemento de Workout.blocks[] del mismo Workout.
  // null/ausente = ejercicio suelto, sin agrupar.
  blockId: { type: Schema.Types.ObjectId, default: null },
  sets: { type: [SetSchema], default: [] },
});

module.exports = CustomExerciseSchema;
