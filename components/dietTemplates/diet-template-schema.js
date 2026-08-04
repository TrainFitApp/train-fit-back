const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Replanteamiento MVP (nutrición) — plantilla de dieta reutilizable del
// profesional, mismo espíritu que las plantillas de Table (rutinas): se
// construye una vez y se aplica a N clientes en vez de teclear cada comida
// de cada cliente de cada día a mano. `customProducts`/`customRecipes` usan
// el mismo formato "clipboard" crudo que ya acepta `mealModel.pasteMeal`
// (ver F12/F28) — se materializan como documentos reales solo al aplicar la
// plantilla a un cliente (diet-template-controller.js#applyToClient).
const DietTemplateSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    days: [
      {
        // Etiqueta libre ("Día 1", "Lunes") — NO atada a una fecha real; la
        // fecha real se decide al aplicar la plantilla a un cliente.
        dayLabel: { type: String, trim: true, maxlength: 50, required: true },
        meals: [
          {
            // Debe coincidir con diet-days-util.js#MEALS (Desayuno/Almuerzo/
            // Comida/Merienda/Cena/Recena) para resolverse contra el DietDay
            // real del cliente al aplicar.
            slot: { type: String, required: true, trim: true, maxlength: 50 },
            customProducts: { type: [Schema.Types.Mixed], default: [] },
            customRecipes: { type: [Schema.Types.Mixed], default: [] },
          },
        ],
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "diettemplates" }
);

module.exports = mongoose.model("DietTemplate", DietTemplateSchema);
