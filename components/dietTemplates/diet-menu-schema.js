const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const MealAlternativeSchema = require("../meals/meal-alternative-schema");

// Un menú de un plan de dieta: días intercambiables ("Entrenamiento",
// "Descanso"…) entre los que el cliente elige cada día. Cada comida (hueco
// del día) tiene 0, 1 o varias alternativas: 0 = comida vacía, 1 = sin
// elección, 2+ = el cliente elige cuál comer ese día. El nombre del menú es la
// CLAVE de la elección (se guarda en DietDay.menuName), así que dos menús del
// mismo plan no pueden llamarse igual (diet-menus.js#sanitizeMenus).
//
// Lo usan las plantillas de biblioteca (DietTemplate.menus) y el contenido de
// cada fase asignada (DietPhase.contents[].menus): misma forma en los dos.

const DietMenuMealSchema = new Schema(
  {
    // Debe coincidir con diet-days-util.js#MEALS (Desayuno/Almuerzo/Comida/
    // Merienda/Cena/Recena) para resolverse contra el DietDay real del cliente.
    slot: { type: String, required: true, trim: true, maxlength: 50 },
    alternatives: { type: [MealAlternativeSchema], default: [] },
  },
  { _id: false },
);

const DietMenuSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    meals: { type: [DietMenuMealSchema], default: [] },
  },
  { _id: false },
);

module.exports = DietMenuSchema;
