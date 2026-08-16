const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// "Proponer" (funcionalidad 8): 2+ alternativas para que el cliente elija,
// a diferencia de "pautar" (fijar directo, sin propuesta — solo marca
// Meal.assignedByTrainerId). Cada alternativa referencia un Meal real
// desvinculado (clon, mismo patrón que DietTemplate/MealSnippet).
const MealProposalSchema = new Schema({
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  clientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  date: { type: String, required: true },
  mealSlot: { type: Number, required: true, min: 0, max: 5 },
  alternatives: [
    {
      label: { type: String, trim: true, maxlength: 100 },
      meal: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
    },
  ],
  chosenIndex: { type: Number, default: null },
});

module.exports = mongoose.model("MealProposal", MealProposalSchema);
