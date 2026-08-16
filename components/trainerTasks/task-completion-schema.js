const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TaskCompletionSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: "TrainerTask", required: true, index: true },
  date: { type: String, required: true },
  completed: { type: Boolean, default: false },
});

// Una entrada por tarea y día.
TaskCompletionSchema.index({ taskId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("TaskCompletion", TaskCompletionSchema);
