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
  // TODO Esto no debería ser obligatorio por el caso de las recetas
  mealId: {
    type: Schema.Types.ObjectId,
    ref: "Meal",
  },
});

CustomProductSchema.plugin(require("mongoose-autopopulate"));

module.exports = mongoose.model("CustomProduct", CustomProductSchema);
