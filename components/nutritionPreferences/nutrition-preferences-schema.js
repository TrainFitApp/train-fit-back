const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ClientNutritionPreferencesSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  allergies: { type: String, default: "", trim: true, maxlength: 1000 },
  // Restricciones dietéticas ESTRUCTURADas — filtro duro del cajón de
  // sugerencias de dieta (se cruzan contra DietTemplate.suitableFor). El
  // texto libre de `allergies` se queda para los matices que no encajan en
  // un flag ("alergia a frutos secos"). Mismos valores que los flags de
  // Product/CustomProduct.
  dietaryFlags: {
    type: [String],
    enum: ["vegan", "vegetarian", "lactoseFree", "glutenFree"],
    default: () => [],
  },
  favoriteFoods: { type: String, default: "", trim: true, maxlength: 1000 },
  dislikedFoods: { type: String, default: "", trim: true, maxlength: 1000 },
  cooksAtHome: { type: String, enum: ["yes", "no", "sometimes", null], default: null },
  // TASK-004 (MASTER_BACKLOG.md) — fix mínimo: los 6 slots de comida siguen
  // siendo un enum fijo en todo el resto del sistema (diet-days-util.js,
  // diet-template-schema.js, meal.ts...) — deliberadamente NO se toca ese
  // modelo. Esto es solo una preferencia de PRESENTACIÓN por cliente: qué
  // slots de los 6 estándar (Desayuno/Almuerzo/Comida/Merienda/Cena/Recena)
  // le aplican de verdad (ayuno intermitente, 4-5 tomas...) y cómo prefiere
  // llamarlos (resuelve la confusión cultural Almuerzo/Comida). Aplicar esto
  // a la renderización real de la dieta queda como tarea de seguimiento — ver
  // MASTER_BACKLOG.md.
  disabledMealSlots: { type: [String], default: [] },
  mealSlotLabels: { type: Map, of: String, default: {} },
  requestedAt: { type: Date, default: null },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  respondedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { collection: "clientnutritionpreferences" });

module.exports = mongoose.model("ClientNutritionPreferences", ClientNutritionPreferencesSchema);
