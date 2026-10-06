const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const CustomProductSchema = require("../customProducts/custom-product-schema");
const CustomRecipeSchema = require("../customRecipes/custom-recipe-schema");

// Una opción para un hueco de comida: lo mismo que se pauta (alimentos y
// recetas) con un nombre. La usan las comidas de los menús de dieta
// (dietTemplates/diet-menu-schema.js: plantillas y fases) y las comidas del
// diario a las que el plan pone varias opciones (DietDay.meals[].alternatives):
// misma forma en los dos sitios.
const MealAlternativeSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 100, default: "" },
    customProducts: { type: [CustomProductSchema], default: [] },
    customRecipes: { type: [CustomRecipeSchema], default: [] },
  },
  { _id: false },
);

module.exports = MealAlternativeSchema;
