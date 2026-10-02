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
  // Adición rápida (2026-10) — línea suelta que el cliente apunta con sus
  // macros a mano, sin crear un Product en el catálogo: `product` queda
  // vacío y el nombre vive aquí. Cuando hay `product` manda el nombre del
  // producto base, así que quien pinte un CustomProduct lee siempre
  // `product?.name || name` (mismo orden que shopping-list-service.js).
  name: { type: String, trim: true, maxlength: 100 },
  // Marca explícita de esa adición rápida. Hoy es redundante con "no hay
  // product", pero es lo que distingue una línea escrita a mano de un
  // CustomProduct al que le falte la referencia por un dato corrupto, y lo
  // que mira el cliente para abrir el editor correcto.
  quickAdd: { type: Boolean, default: false },

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
  ingredients: { type: String, trim: true, maxlength: 5000 },
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
  // Pautado por trainer — mismo criterio que Meal.assignedByTrainerId
  // (meal-schema.js): presente si un profesional pautó este producto
  // (meal-dao.js#pasteMeal). Permanente, protege de borrado/edición directa
  // del cliente (ver meal-service.js#assertMealEditable, reutilizada aquí a
  // nivel de item en vez de solo a nivel de Meal completa).
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Cantidad ORIGINAL pautada (gramos) — se estampa una sola vez junto con
  // assignedByTrainerId (meal-dao.js#pasteMeal) y nunca vuelve a tocarse.
  // `quantity` pasa a ser la cantidad REALMENTE consumida, editable por el
  // cliente vía setCustomProductQuantity (seguimiento, no composición: ver
  // el mismo criterio que consumed más abajo); assignedQuantity es la
  // referencia contra la que se calcula el delta que ve el cliente
  // (+46/-28 sobre lo pautado). null en productos que nunca fueron pautados.
  assignedQuantity: { type: Number, min: 0, max: 100000, default: null },
  // El cliente lo marca como tomado — nunca bloqueado por
  // assignedByTrainerId (mismo criterio que Meal.completed: seguimiento y
  // composición son conceptos distintos).
  consumed: { type: Boolean, default: false },
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
