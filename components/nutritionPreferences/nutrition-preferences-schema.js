const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const DIETARY_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

// Preferencias y restricciones de nutrición del cliente. Desde 2026-10 viven
// EMBEBIDAS en su usuario (User.nutritionPreferences): eran una colección
// propia (`clientnutritionpreferences`) con exactamente un documento por
// cliente, que solo se leía y escribía por `clientId`. Sin subdocumento =
// nunca se han pedido ni respondido (nutrition-preferences-dao.js devuelve
// null, como antes sin documento).
const NutritionPreferencesSchema = new Schema(
  {
    allergies: { type: String, default: "", trim: true, maxlength: 1000 },
    // Restricciones dietéticas ESTRUCTURADas — filtro duro del cajón de
    // sugerencias de dieta (se cruzan contra DietTemplate.suitableFor). El
    // texto libre de `allergies` se queda para los matices que no encajan en
    // un flag ("alergia a frutos secos"). Mismos valores que los flags de
    // Product/CustomProduct.
    dietaryFlags: { type: [String], enum: DIETARY_FLAGS, default: () => [] },
    favoriteFoods: { type: String, default: "", trim: true, maxlength: 1000 },
    dislikedFoods: { type: String, default: "", trim: true, maxlength: 1000 },
    cooksAtHome: { type: String, enum: ["yes", "no", "sometimes", null], default: null },
    // Preferencia de PRESENTACIÓN por cliente: qué slots de los 6 estándar
    // (Desayuno/Almuerzo/Comida/Merienda/Cena/Recena) le aplican de verdad
    // (ayuno intermitente, 4-5 tomas...) y cómo prefiere llamarlos. Los 6
    // slots siguen siendo un enum fijo en el resto del sistema.
    disabledMealSlots: { type: [String], default: [] },
    mealSlotLabels: { type: Map, of: String, default: {} },
    requestedAt: { type: Date, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    respondedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

module.exports = NutritionPreferencesSchema;
module.exports.DIETARY_FLAGS = DIETARY_FLAGS;
