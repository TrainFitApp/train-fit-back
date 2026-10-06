const mongoose = require("mongoose");
const Schema = mongoose.Schema;
// `workouts` se autopuebla al leer la rutina: el modelo Workout tiene que
// estar registrado aunque quien lea la Table no lo haya pedido.
require("../workouts/workout-schema");

// Qué es este microciclo dentro del plan.
//
// Un bloque de acumulación, uno de intensificación y una descarga se leen y
// se juzgan de forma distinta: un volumen que baja un 40% es una alarma en
// el primero y exactamente lo previsto en la tercera. "regular" por defecto:
// todos los microciclos que ya existían lo son.
const SPLIT_PURPOSES = [
  { key: "regular", label: "Normal" },
  { key: "accumulation", label: "Acumulación" },
  { key: "intensification", label: "Intensificación" },
  { key: "peak", label: "Pico" },
  { key: "deload", label: "Descarga" },
  { key: "vacation", label: "Vacaciones" },
];

// Un microciclo. Desde 2026-10 vive EMBEBIDO en su rutina (Table.splits[]):
// solo guarda su nombre, su propósito y qué sesiones (Workout) tiene, en
// orden. Antes era una colección propia que obligaba a reconstruir el orden
// a mano en cada agregación ($lookup no conserva el orden del array). Se
// conserva el `_id` de cada microciclo: las rutas /splits/... reciben el
// mismo id.
const SplitSchema = new Schema({
  name: { type: String, trim: true, maxlength: 100 },
  // El objetivo del bloque, escrito por el entrenador ("subir series de
  // espalda sin tocar pierna").
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

module.exports = SplitSchema;
module.exports.SPLIT_PURPOSES = SPLIT_PURPOSES;
