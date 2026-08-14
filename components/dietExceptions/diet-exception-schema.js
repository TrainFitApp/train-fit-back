const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Auditoría de arquitectura (nutrición) — ajuste puntual sobre UNA fecha
// exacta de una asignación activa, sin tocar el plan en sí. Ejemplos reales:
// un viaje, una comida familiar, una semana de vacaciones. `mealSlot: null`
// afecta al día entero (p. ej. "vacaciones"); con `mealSlot` afecta solo esa
// comida concreta.
const DietExceptionSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: "PlanAssignment", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    mealSlot: { type: String, default: null },
    action: { type: String, enum: ["override", "skip"], required: true },
    // Mismo formato "clipboard" que DietTemplate/MealSnippet — solo se usa
    // cuando action === "override".
    override: {
      customProducts: { type: [Schema.Types.Mixed], default: [] },
      customRecipes: { type: [Schema.Types.Mixed], default: [] },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "dietexceptions" }
);

DietExceptionSchema.index({ clientId: 1, date: 1 });

module.exports = mongoose.model("DietException", DietExceptionSchema);
