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
  // De dónde salen estos números: "calculated" = recalculados del perfil del
  // cliente (Mifflin + gasto + reparto), "manual" = tecleados encima. Un
  // objetivo manual NO se pisa al recalcular: si alguien decidió esas kcal,
  // cambiar de peso no debe borrarlas sin avisar.
  source: { type: String, enum: ["calculated", "manual"], default: "calculated" },
  // Quién los tecleó, cuando no fue el propio cliente. El profesional puede
  // editar el objetivo de su cliente desde Plan > Nutrición.
  updatedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

NutritionalGoalSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("NutritionalGoal", NutritionalGoalSchema);
