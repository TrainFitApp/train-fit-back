const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomProductSchema = Schema({
  quantity: Number,
  order: Number,
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    autopopulate: true,
  },

  energyKcal100g: Number,
  protein100g: Number,
  carbohydrates100g: Number,
  fat100g: Number,
  saturatedFat100g: Number,
  sugars100g: Number,
  fiber100g: Number,
  salt100g: Number,
  sodium100g: Number,
  cholesterol100g: Number,
  transFat100g: Number,

  // Minerales
  calcium100g: Number,
  iron100g: Number,
  magnesium100g: Number,
  phosphorus100g: Number,
  potassium100g: Number,
  zinc100g: Number,
  copper100g: Number,
  manganese100g: Number,
  selenium100g: Number,
  iodine100g: Number,

  // Vitaminas
  vitaminA100g: Number,
  vitaminC100g: Number,
  vitaminD100g: Number,
  vitaminE100g: Number,
  vitaminK100g: Number,
  vitaminB1100g: Number,
  vitaminB2100g: Number,
  vitaminB3100g: Number,
  vitaminB5100g: Number,
  vitaminB6100g: Number,
  vitaminB9100g: Number,
  vitaminB12100g: Number,
  biotin100g: Number,

  // Otros
  omega3100g: Number,
  omega6100g: Number,
  omega9100g: Number,
  caffeine100g: Number,
  taurine100g: Number,
  alcohol100g: Number,
  ingredients: String,
  allergens: [String],
  traces: [String],
  vegan: Boolean,
  vegetarian: Boolean,
  lactoseFree: Boolean,
  glutenFree: Boolean,
  // TODO Esto no debería ser obligatorio por el caso de las recetas
  mealId: {
    type: Schema.Types.ObjectId,
    ref: "Meal",
  },
  customRecipeId: {
    type: Schema.Types.ObjectId,
    ref: "CustomRecipe",
    index: true,
  },
  baseCustomProductId: {
    type: Schema.Types.ObjectId,
    ref: "CustomProduct",
    autopopulate: true,
    index: true,
  },
});

CustomProductSchema.plugin(require("mongoose-autopopulate"));

module.exports = mongoose.model("CustomProduct", CustomProductSchema);
