const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Nota anclada a un ejercicio por POSICIÓN (fila de entrenamiento y orden del
// ejercicio), compartida por todos los microciclos de la rutina. Desde
// 2026-10 vive EMBEBIDA en su rutina (Table.pinnedNotes[]): nace, se mueve y
// se borra con ella, sin colección ni cascada aparte. La posición es única
// dentro de la tabla (lo garantiza pinned-exercise-note-dao.js#upsert).
const PinnedExerciseNoteSchema = new Schema({
  workoutIndex: { type: Number, required: true, min: 0 },
  exerciseIndex: { type: Number, required: true, min: 0 },
  notes: { type: String, required: true, trim: true, maxlength: 500 },
  authorRole: { type: String, enum: ["trainer", "client", null], default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = PinnedExerciseNoteSchema;
