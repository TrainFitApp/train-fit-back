const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Un documento por (tarea, día) — el cliente la marca hecha o no. Mismo
// formato de fecha (YYYY-MM-DD) que DietDay.date, comparado por igualdad
// estricta, no por rango de Date.
const TaskCompletionSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "TrainerTask", required: true, index: true },
    date: { type: String, required: true },
    completed: { type: Boolean, default: true },
    completedAt: { type: Date, default: Date.now },
  },
  { collection: "taskcompletions" }
);

TaskCompletionSchema.index({ taskId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("TaskCompletion", TaskCompletionSchema);
