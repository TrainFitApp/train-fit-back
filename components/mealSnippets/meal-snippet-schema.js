const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// TAREA5 (auditoría UX, Fase C) — "pieza suelta" reutilizable más pequeña
// que una DietTemplate completa: una sola comida ("Desayuno alto en
// proteína") insertable en 1 clic dentro de cualquier día/celda del
// tablero semanal o directamente al pautar comida a un cliente. Mismo
// formato "clipboard" que DietTemplate/mealModel.pasteMeal — sin `slot`
// propio: el snippet no sabe a qué comida del día va, eso lo decide quien
// lo inserta.
const MealSnippetSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    customProducts: { type: [Schema.Types.Mixed], default: [] },
    customRecipes: { type: [Schema.Types.Mixed], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "mealsnippets" }
);

module.exports = mongoose.model("MealSnippet", MealSnippetSchema);
