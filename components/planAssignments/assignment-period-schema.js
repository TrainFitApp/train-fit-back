const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Sub-schema embebido (sin colección propia), compartido por PlanAssignment
// (dietas, funcionalidad 6) y NutritionalGoal (funcionalidad 7) — reutilizado
// tal cual, sin redefinir campos (ver docs/trainfit-trainers/05-especificaciones-acordadas.md).
const AssignmentPeriodSchema = new Schema(
  {
    startDate: { type: Date, required: true },
    endMode: {
      type: String,
      enum: ["fixedDate", "duration", "indefinite"],
      required: true,
    },
    // Solo relevante si endMode === "fixedDate".
    endDate: { type: Date, default: null },
    // Solo relevante si endMode === "duration".
    durationDays: { type: Number, default: null },
  },
  { _id: false }
);

module.exports = AssignmentPeriodSchema;
