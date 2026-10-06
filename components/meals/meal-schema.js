const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const CustomProductSchema = require("../customProducts/custom-product-schema");
const CustomRecipeSchema = require("../customRecipes/custom-recipe-schema");
const MealAlternativeSchema = require("./meal-alternative-schema");

// Una comida (una ingesta del día). Vive EMBEBIDA en su día (DietDay.meals[],
// los 6 huecos estándar) con sus alimentos y recetas dentro.
//
// Las comidas guardadas del entrenador (snippets) tienen su propia colección
// (mealSnippets/meal-snippet-schema.js) con estos mismos campos de contenido.
const MealSchema = new Schema({
  name: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 500 },
  // Presente si un profesional pautó esta comida entera: el cliente no puede
  // cambiar su composición (meal-service.js#assertMealEditable), solo
  // registrar el cumplimiento.
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  customProducts: { type: [CustomProductSchema], default: [] },
  customRecipes: { type: [CustomRecipeSchema], default: [] },
  // Opciones que el plan del profesional pone en este hueco (ver
  // meal-alternatives.js). Vacío (el 99% del tiempo) = nada que elegir. NO se
  // vacía al elegir: el cliente alterna cuantas veces quiera y lo que cambia
  // es `chosenAlternativeIndex`; la elegida se copia a
  // customProducts/customRecipes.
  alternatives: { type: [MealAlternativeSchema], default: [] },
  // Con alternativas siempre está puesto (la comida nace con la opción 1
  // aplicada, índice 0). null = sin alternativas.
  chosenAlternativeIndex: { type: Number, default: null },
  // Quién propuso las alternativas: el cliente ve "te ha propuesto tu
  // entrenador" y pasteMeal lo necesita para marcar assignedByTrainerId.
  alternativesTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = MealSchema;
