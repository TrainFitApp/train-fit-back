const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Qué notas del cliente ha visto cada entrenador. Colección aparte y no un
// campo en cada nota: el cliente nunca debe ver este estado, cada
// entrenador (uno por scope) lleva el suyo, y así no se toca ninguno de los
// seis modelos de donde salen las notas.
//
// textHash es el texto que había cuando se marcó: si el cliente edita la
// nota, el hash deja de coincidir y vuelve a salir como no vista. Workout y
// CustomExercise no tienen updatedAt, así que la fecha no servía.
const TrainerNoteReadSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // "<sourceType>:<sourceId>", ver client-notes-builder.js#noteKey.
    noteKey: { type: String, required: true },
    textHash: { type: String, required: true },
    readAt: { type: Date, default: Date.now },
  },
  { collection: "trainernotereads" }
);

TrainerNoteReadSchema.index({ trainerId: 1, clientId: 1, noteKey: 1 }, { unique: true });

module.exports = mongoose.model("TrainerNoteRead", TrainerNoteReadSchema);
