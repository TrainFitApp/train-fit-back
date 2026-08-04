const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// MVP-trainers F28 — 2-3 alternativas nombradas para el mismo hueco de
// comida en una fecha; el cliente elige cuál se aplica de verdad (pasteMeal
// se dispara al elegir, no al proponer — a diferencia de F12, que es
// inmediato).
//
// `customProducts`/`customRecipes` de cada alternativa se guardan como datos
// crudos (Mixed), NO como referencias a documentos ya creados — el mismo
// formato "clipboard" que ya acepta `mealModel.pasteMeal` (ver F12,
// `prescribeMeal`). Solo se materializan como documentos reales de
// CustomProduct/CustomRecipe en el momento de "elegir" (POST .../choose),
// reutilizando pasteMeal tal cual en vez de duplicar su lógica de clonado.
const MealProposalSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  date: { type: String, required: true }, // YYYY-MM-DD, mismo formato que DietDay.date
  mealSlot: { type: String, required: true }, // nombre de la comida (Desayuno, Comida, ...)
  alternatives: [
    {
      label: { type: String, trim: true, maxlength: 100, required: true },
      customProducts: { type: [Schema.Types.Mixed], default: [] },
      customRecipes: { type: [Schema.Types.Mixed], default: [] },
    },
  ],
  chosenIndex: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
}, { collection: "mealproposals" });

MealProposalSchema.index({ clientId: 1, date: 1, mealSlot: 1 });

module.exports = mongoose.model("MealProposal", MealProposalSchema);
