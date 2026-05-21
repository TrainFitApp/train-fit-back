const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  LIMITS,
  stringField,
  applyRunValidators,
} = require("../util/validation-limits");

const RecipeSchema = Schema(
  {
    // Nombre de la receta
    name: {
      ...stringField(
        LIMITS.text.shortNameMax,
        true,
        LIMITS.text.shortNameMin,
      ),
      required: true,
    },
    nameNormalized: String,
    namePrefixes: [String],
    // Descripción opcional
    description: stringField(LIMITS.text.descriptionMax),
    // Array de CustomProducts (referencias inmutables)
    customProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "CustomProduct",
        autopopulate: true,
      },
    ],
    // Si está verificada por admin
    verified: {
      type: Boolean,
      default: false,
    },
    // Creador de la receta (si es un usuario, no es verificada)
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // Añade createdAt, updatedAt
    strict: true,
  },
);

// IMPORTANTE: Recipe es la base compartida de la receta.
// Las variaciones por comida se representan en CustomRecipe.

RecipeSchema.plugin(require("mongoose-autopopulate"));
applyRunValidators(RecipeSchema);

module.exports = mongoose.model("Recipe", RecipeSchema);
