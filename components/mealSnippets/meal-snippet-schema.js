const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Comida reutilizable del trainer, para componer propuestas/pautas
// (funcionalidad 8) sin reconstruirla cada vez. Referencia un Meal real
// desvinculado — mismo patrón que DietTemplate (funcionalidad 6).
const MealSnippetSchema = new Schema({
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  meal: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
});

module.exports = mongoose.model("MealSnippet", MealSnippetSchema);
