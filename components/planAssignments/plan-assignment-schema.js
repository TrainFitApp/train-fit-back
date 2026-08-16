const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const AssignmentPeriodSchema = require("./assignment-period-schema");

// Aplicación de una DietTemplate a un cliente concreto, con vigencia —
// funcionalidad 6. `supersededBy` encadena fases (un plan nuevo reemplaza al
// anterior sin perder el histórico, mismo criterio que TrainerClient con
// invitaciones — ver funcionalidad 2).
const PlanAssignmentSchema = new Schema({
  planId: {
    type: Schema.Types.ObjectId,
    ref: "DietTemplate",
    required: true,
  },
  clientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  period: { type: AssignmentPeriodSchema, required: true },
  status: {
    type: String,
    enum: ["active", "ended", "superseded"],
    default: "active",
    index: true,
  },
  supersededBy: {
    type: Schema.Types.ObjectId,
    ref: "PlanAssignment",
    default: null,
  },
});

module.exports = mongoose.model("PlanAssignment", PlanAssignmentSchema);
