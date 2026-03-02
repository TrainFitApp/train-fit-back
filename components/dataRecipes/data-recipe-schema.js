const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const DataRecipeSchema = Schema(
  {
    // REFERENCIA INMUTABLE a la receta original
    recipe: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      autopopulate: true,
      required: true,
    },
    // Cantidad cruda (gramos) - opcional
    quantity: Number,
    // Cantidad tras cocinar (gramos) - opcional
    // Cantidad tras cocinar (gramos) - opcional
    quantityCooked: Number,
  },
  {
    timestamps: false, // Desactiva createdAt, updatedAt
    strict: true,
  },
);

DataRecipeSchema.plugin(require("mongoose-autopopulate"));

module.exports = mongoose.model("DataRecipe", DataRecipeSchema);
