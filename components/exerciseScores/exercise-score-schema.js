const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Movimiento 6 Coach Pro — la puntuación que UN entrenador le da a UN
// ejercicio. Ver exercise-score-catalog.js para por qué no vive dentro de
// Exercise (el catálogo de ejercicios es compartido por toda la plataforma).
const ScoreEntrySchema = new Schema(
  {
    name: { type: String, required: true },
    score: { type: Number, min: 0, max: 3, required: true },
  },
  { _id: false }
);

const ExerciseScoreSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    exerciseId: { type: Schema.Types.ObjectId, ref: "Exercise", required: true },
    // Solo los grupos con puntuación distinta de 0: guardar dieciséis ceros
    // por ejercicio multiplicaría el tamaño de la colección para no decir
    // nada. La ausencia ya significa cero al sumar.
    muscleScores: { type: [ScoreEntrySchema], default: [] },
    jointScores: { type: [ScoreEntrySchema], default: [] },
    // Duración estimada de UNA serie de este ejercicio, en segundos, sin
    // contar el descanso. Opcional: sin ella, el tiempo de sesión se estima
    // con un valor por defecto (ver session-load-service.js).
    secondsPerSet: { type: Number, min: 0, max: 600, default: null },
  },
  { timestamps: true }
);

// Un entrenador puntúa un ejercicio una sola vez: si cambia de criterio,
// edita el que hay.
ExerciseScoreSchema.index({ trainerId: 1, exerciseId: 1 }, { unique: true });

ExerciseScoreSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"] });

module.exports = mongoose.model("ExerciseScore", ExerciseScoreSchema);
