const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const CustomProductSchema = require("../customProducts/custom-product-schema");
// `recipe` se autopuebla también al guardar el documento que la contiene.
require("../recipes/recipe-schema");

// Una receta puesta en un plato: referencia a la Recipe y SOLO lo que difiere
// (ingredientes añadidos, cambiados o quitados), nunca una copia completa.
// Vive EMBEBIDA donde se usa (DietDay.meals[].customRecipes[], los menús de
// DietTemplate y DietPhase, MealSnippet) con sus ingredientes dentro.
const CustomRecipeSchema = new Schema({
  recipe: {
    type: Schema.Types.ObjectId,
    ref: "Recipe",
    autopopulate: true,
    required: true,
  },
  quantity: { type: Number, min: 0, default: null },
  quantityCooked: { type: Number, min: 0, default: null },
  addedCustomProducts: { type: [CustomProductSchema], default: [] },
  modifiedBaseCustomProducts: { type: [CustomProductSchema], default: [] },
  // `_id` de ingredientes de la Recipe (Recipe.customProducts[]) quitados.
  removedBaseCustomProductIds: { type: [Schema.Types.ObjectId], default: [] },
  // Pautado por el profesional — mismo criterio que en CustomProduct.
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assignedQuantity: { type: Number, min: 0, default: null },
  // El cliente la marca como tomada — nunca bloqueado por assignedByTrainerId.
  consumed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = CustomRecipeSchema;
