const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PinnedExerciseNoteSchema = Schema({
  tableId: {
    type: Schema.Types.ObjectId,
    ref: "Table",
    required: true,
    index: true,
  },
  workoutIndex: {
    type: Number,
    required: true,
  },
  exerciseIndex: {
    type: Number,
    required: true,
  },
  notes: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  // 2026-09 — quién la ancló (ver tables/note-authorship.js). null = anterior
  // a este campo: la puede tocar cualquiera y cuenta como del cliente.
  authorRole: {
    type: String,
    enum: ["trainer", "client"],
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

PinnedExerciseNoteSchema.index(
  { tableId: 1, workoutIndex: 1, exerciseIndex: 1 },
  { unique: true }
);

PinnedExerciseNoteSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

PinnedExerciseNoteSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model("PinnedExerciseNote", PinnedExerciseNoteSchema);