const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  LIMITS,
  stringField,
  numberField,
  stringArrayField,
  applyRunValidators,
} = require("../util/validation-limits");

const CustomProductSchema = Schema({
  quantity: numberField(LIMITS.nutrition.quantityMin, LIMITS.nutrition.quantityMax),
  order: Number,
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    autopopulate: true,
  },

  energyKcal100g: numberField(LIMITS.nutrition.kcal100gMin, LIMITS.nutrition.kcal100gMax),
  protein100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  carbohydrates100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  fat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  saturatedFat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  sugars100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  fiber100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  salt100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  sodium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  cholesterol100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  transFat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),

  // Minerales
  calcium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  iron100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  magnesium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  phosphorus100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  potassium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  zinc100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  copper100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  manganese100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  selenium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  iodine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),

  // Vitaminas
  vitaminA100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminC100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminD100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminE100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminK100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB1100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB2100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB3100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB5100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB6100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB9100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB12100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  biotin100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),

  // Otros
  omega3100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  omega6100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  omega9100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  caffeine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  taurine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  alcohol100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  ingredients: stringField(LIMITS.text.ingredientsMax),
  allergens: stringArrayField(LIMITS.text.allergensMax),
  traces: stringArrayField(LIMITS.text.allergensMax),
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
applyRunValidators(CustomProductSchema);

module.exports = mongoose.model("CustomProduct", CustomProductSchema);
