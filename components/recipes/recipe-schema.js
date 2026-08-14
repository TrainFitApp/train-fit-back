const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const RecipeSchema = Schema(
  {
    // Nombre de la receta
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    nameNormalized: String,
    namePrefixes: [String],
    // Descripción opcional
    description: { type: String, trim: true, maxlength: 2000 },
    // TASK-046 (MASTER_BACKLOG.md) — categorización libre (tipo de cocina,
    // dieta, etc.), filtrable en searchRecipes. Sin catálogo cerrado
    // deliberadamente — mismo criterio que Exercise.category (string libre
    // por receta, no un enum), para no bloquear al trainer a una taxonomía
    // fija que no encaje con su forma de organizar recetas.
    tags: { type: [String], default: [] },
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

module.exports = mongoose.model("Recipe", RecipeSchema);
