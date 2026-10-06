const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const CustomExerciseSchema = require("../customExercises/custom-exercise-schema");

// Lo común a una SESIÓN de una rutina (`Workout`, workout-schema.js) y a una
// PLANTILLA suelta del profesional (`WorkoutTemplate`,
// workoutTemplates/workout-template-schema.js): nombre, nota, bloques y los
// ejercicios con sus series. Las dos viven en la colección `workouts` y se
// distinguen por `kind` ("session" | "template"): cada modelo lleva solo sus
// campos y filtra solo sus documentos en cualquier consulta (find, update,
// count, aggregate…), sin guardarraíles a mano.
//
// Este modelo base no se usa para leer ni escribir sesiones o plantillas:
// solo para lo que de verdad abarca las dos (cuántas veces se usa un
// ejercicio, borrar en cascada).

// Bloques/superseries: solo metadata de agrupación (nombre, tipo, rondas,
// descansos); cada ejercicio de exercises[] apunta a su bloque vía blockId
// (ObjectId de un elemento de este array).
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

const WorkoutBaseSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    // La indicación de quien construye la sesión o la plantilla (el
    // entrenador si la rutina está asignada). Lo que apunta el cliente al
    // entrenar va en `Workout.clientNotes`.
    notes: { type: String, trim: true, maxlength: 500 },
    blocks: { type: [WorkoutBlockSchema], default: [] },
    // Los ejercicios con sus series, dentro del documento: se lee, se copia
    // y se borra de una vez, y una escritura sobre él es atómica.
    exercises: { type: [CustomExerciseSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "workouts", discriminatorKey: "kind" },
);

WorkoutBaseSchema.plugin(require("mongoose-autopopulate"));

// Las rutas por id de ejercicio o de serie (/customexercises/:id, /sets/:id)
// localizan su sesión por estos campos, y contar el uso de un ejercicio del
// catálogo por el último.
WorkoutBaseSchema.index({ "exercises._id": 1 });
WorkoutBaseSchema.index({ "exercises.sets._id": 1 });
WorkoutBaseSchema.index({ "exercises.exercise": 1 });

module.exports = mongoose.model("WorkoutBase", WorkoutBaseSchema);
