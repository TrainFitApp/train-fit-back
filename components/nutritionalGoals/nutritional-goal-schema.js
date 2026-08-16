const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const AssignmentPeriodSchema = require("../planAssignments/assignment-period-schema");

const NutritionalGoalSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    default: "Default",
    trim: true,
    maxlength: 100,
  },
  kcalTotal: { type: Number, default: 0 },
  proteinsGTotal: { type: Number, default: 0 },
  carbohydratesGTotal: { type: Number, default: 0 },
  fatGTotal: { type: Number, default: 0 },
  // Funcionalidad 7 — presente (con valor) solo si un trainer asignó este
  // objetivo (mismo patrón que Table.assignedByTrainerId/Workout.trainerId,
  // funcionalidad 5). Mientras haya relación activa, bloquea edición directa
  // del cliente (ver nutritional-goal-service.js#assertEditableByClient).
  assignedByTrainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  period: { type: AssignmentPeriodSchema, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

NutritionalGoalSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("NutritionalGoal", NutritionalGoalSchema);
