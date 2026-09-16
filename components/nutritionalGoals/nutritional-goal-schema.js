const mongoose = require("mongoose");
const Schema = mongoose.Schema;

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
  // Fase 5 Coach Pro — "fibra si procede" (§15). `null` y no 0 a propósito:
  // un objetivo sin fibra definida no es "0 g de fibra", es que ese coach no
  // la pauta. Todo lo que ya existía sigue funcionando igual — el campo es
  // opcional y nada lo exige.
  fiberGTotal: { type: Number, default: null },
  // Auditoría de arquitectura (nutrición) — mismo concepto de periodo que
  // PlanAssignment, opcional y retrocompatible: un objetivo sin estos campos
  // se sigue comportando exactamente como hoy (el "actual" es el que apunta
  // User.goalInUse, sin vigencia temporal). Con ellos, un objetivo puede
  // programarse para una fase futura conocida.
  startDate: { type: String, default: null },
  endMode: { type: String, enum: ["fixedDate", "duration", "indefinite", null], default: null },
  endDate: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

NutritionalGoalSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("NutritionalGoal", NutritionalGoalSchema);
