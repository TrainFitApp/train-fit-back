const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomProductSchema = Schema({
  quantity: { type: Number, min: 0, max: 100000 },
  order: Number,
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    autopopulate: true,
  },

  energyKcal100g: { type: Number, min: 0, max: 100000 },
  protein100g: { type: Number, min: 0, max: 100000 },
  carbohydrates100g: { type: Number, min: 0, max: 100000 },
  fat100g: { type: Number, min: 0, max: 100000 },
  saturatedFat100g: { type: Number, min: 0, max: 100000 },
  sugars100g: { type: Number, min: 0, max: 100000 },
  fiber100g: { type: Number, min: 0, max: 100000 },
  salt100g: { type: Number, min: 0, max: 100000 },
  sodium100g: { type: Number, min: 0, max: 100000 },
  cholesterol100g: { type: Number, min: 0, max: 100000 },
  transFat100g: { type: Number, min: 0, max: 100000 },

  // Minerales
  calcium100g: { type: Number, min: 0, max: 100000 },
  iron100g: { type: Number, min: 0, max: 100000 },
  magnesium100g: { type: Number, min: 0, max: 100000 },
  phosphorus100g: { type: Number, min: 0, max: 100000 },
  potassium100g: { type: Number, min: 0, max: 100000 },
  zinc100g: { type: Number, min: 0, max: 100000 },
  copper100g: { type: Number, min: 0, max: 100000 },
  manganese100g: { type: Number, min: 0, max: 100000 },
  selenium100g: { type: Number, min: 0, max: 100000 },
  iodine100g: { type: Number, min: 0, max: 100000 },

  // Vitaminas
  vitaminA100g: { type: Number, min: 0, max: 100000 },
  vitaminC100g: { type: Number, min: 0, max: 100000 },
  vitaminD100g: { type: Number, min: 0, max: 100000 },
  vitaminE100g: { type: Number, min: 0, max: 100000 },
  vitaminK100g: { type: Number, min: 0, max: 100000 },
  vitaminB1100g: { type: Number, min: 0, max: 100000 },
  vitaminB2100g: { type: Number, min: 0, max: 100000 },
  vitaminB3100g: { type: Number, min: 0, max: 100000 },
  vitaminB5100g: { type: Number, min: 0, max: 100000 },
  vitaminB6100g: { type: Number, min: 0, max: 100000 },
  vitaminB9100g: { type: Number, min: 0, max: 100000 },
  vitaminB12100g: { type: Number, min: 0, max: 100000 },
  biotin100g: { type: Number, min: 0, max: 100000 },

  // Otros
  omega3100g: { type: Number, min: 0, max: 100000 },
  omega6100g: { type: Number, min: 0, max: 100000 },
  omega9100g: { type: Number, min: 0, max: 100000 },
  caffeine100g: { type: Number, min: 0, max: 100000 },
  taurine100g: { type: Number, min: 0, max: 100000 },
  alcohol100g: { type: Number, min: 0, max: 100000 },
  ingredients: { type: String, trim: true, maxlength: 2000 },
  allergens: {
    type: [String],
    validate: {
      validator: (arr) => !arr || arr.every((s) => (s || "").trim().length <= 200),
      message: "Cada alérgeno debe tener 200 caracteres o menos",
    },
  },
  traces: {
    type: [String],
    validate: {
      validator: (arr) => !arr || arr.every((s) => (s || "").trim().length <= 200),
      message: "Cada traza debe tener 200 caracteres o menos",
    },
  },
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
