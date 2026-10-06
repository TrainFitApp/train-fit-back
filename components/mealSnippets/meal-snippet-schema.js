const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const CustomProductSchema = require("../customProducts/custom-product-schema");
const CustomRecipeSchema = require("../customRecipes/custom-recipe-schema");

// Comida guardada del entrenador ("snippet"), reutilizable al pautar. Hasta
// 2026-10 era un Meal con `trainerId` en la colección de comidas, protegido
// de los listados por un filtro implícito; ahora que las comidas del diario
// viven dentro de su día, el snippet tiene colección propia con el mismo
// contenido (alimentos y recetas embebidos). Conserva el `_id` de antes.
const MealSnippetSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, trim: true, maxlength: 100 },
    notes: { type: String, trim: true, maxlength: 500 },
    customProducts: { type: [CustomProductSchema], default: [] },
    customRecipes: { type: [CustomRecipeSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "mealsnippets" },
);

MealSnippetSchema.plugin(require("mongoose-autopopulate"));

MealSnippetSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId"], authorship: ["assignedByTrainerId"] });

module.exports = mongoose.model("MealSnippet", MealSnippetSchema);
