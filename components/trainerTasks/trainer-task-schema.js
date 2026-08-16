const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TASK_TYPES = ["steps", "water", "sleep", "cardio", "custom"];

// Tarea diaria de registro manual asignada por el trainer (funcionalidad
// 13). Colección propia (no embebida en TrainerClient como notas/cobros,
// funcionalidades 11/12): TaskCompletion crece sin límite (una entrada por
// tarea y día), no encaja como subdocumento.
const TrainerTaskSchema = new Schema({
  // Referencia a la GENERACIÓN de relación concreta (no trainerId+clientId
  // sueltos) — si se revoca y se reacepta, las tareas de la relación
  // anterior no se mezclan visualmente con la nueva.
  trainerClientId: {
    type: Schema.Types.ObjectId,
    ref: "TrainerClient",
    required: true,
    index: true,
  },
  type: { type: String, enum: TASK_TYPES, required: true },
  // Solo relevante si type === "custom".
  name: { type: String, trim: true, maxlength: 100 },
  target: { type: Number, required: true, min: 0 },
  unit: { type: String, trim: true, maxlength: 20 },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

TrainerTaskSchema.statics.TASK_TYPES = TASK_TYPES;

module.exports = mongoose.model("TrainerTask", TrainerTaskSchema);
