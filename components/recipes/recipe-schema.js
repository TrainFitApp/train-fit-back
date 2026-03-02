const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RecipeSchema = Schema(
  {
    // Nombre de la receta
    name: {
      type: String,
      required: true,
    },
    // Descripción opcional
    description: String,
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

// IMPORTANTE: Recipe es INMUTABLE después de creación
// Solo se modifica en creación, nunca después
// Los cambios en comidas se hacen en CustomRecipeInstance

RecipeSchema.plugin(require("mongoose-autopopulate"));

module.exports = mongoose.model("Recipe", RecipeSchema);
