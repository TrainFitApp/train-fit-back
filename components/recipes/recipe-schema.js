const mongoose = require("mongoose");
const { buildSearchFields } = require("../util/search-index");
const CustomProductSchema = require("../customProducts/custom-product-schema");
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
    // Derivados de búsqueda, ver components/util/search-index.js.
    nameNormalized: String,
    searchTokens: [String],
    // Descripción opcional: hasta lo que caben los 20 pasos de 300 caracteres
    // de los editores de recetas del front, como en Exercise.
    description: { type: String, trim: true, maxlength: 6500 },
    // TASK-046 (MASTER_BACKLOG.md) — categorización libre (tipo de cocina,
    // dieta, etc.), filtrable en searchRecipes. Sin catálogo cerrado
    // deliberadamente — mismo criterio que Exercise.category (string libre
    // por receta, no un enum), para no bloquear al trainer a una taxonomía
    // fija que no encaje con su forma de organizar recetas.
    tags: { type: [String], default: [] },
    // Ingredientes, EMBEBIDOS (2026-10; antes refs a la colección
    // customproducts). Cada uno conserva su `_id`: es al que apuntan las
    // modificaciones de una receta en el diario (baseCustomProductId).
    customProducts: { type: [CustomProductSchema], default: [] },
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

// ─── Campos derivados de búsqueda ──────────────────────────────────────
// Mismo criterio que Product: los calcula el schema para que no haya forma de
// guardar una receta que la búsqueda no encuentre. Índices en
// scripts/rebuild-indexes.js (npm run rebuild:indexes).

RecipeSchema.pre("save", function syncSearchFieldsOnSave(next) {
  if (this.isModified("name") || !this.nameNormalized) {
    const { nameNormalized, searchTokens } = buildSearchFields({ name: this.name });
    this.nameNormalized = nameNormalized;
    this.searchTokens = searchTokens;
  }
  next();
});

async function syncSearchFieldsOnUpdate() {
  const update = this.getUpdate() || {};
  if (Array.isArray(update)) return;

  const set = update.$set || {};
  const hasName =
    Object.prototype.hasOwnProperty.call(set, "name") ||
    Object.prototype.hasOwnProperty.call(update, "name");

  if (!hasName) return;

  const name = Object.prototype.hasOwnProperty.call(set, "name")
    ? set.name
    : update.name;
  const { nameNormalized, searchTokens } = buildSearchFields({ name });

  this.setUpdate({
    ...update,
    $set: { ...set, nameNormalized, searchTokens },
  });
}

RecipeSchema.pre("findOneAndUpdate", syncSearchFieldsOnUpdate);
RecipeSchema.pre("updateOne", syncSearchFieldsOnUpdate);

// Borrado de cuenta: después del contenido de la propia cuenta, para que solo
// cuente el uso que hacen otros (recipe-dao.js#releaseOwnRecipes).
const { accountCascade, STAGE } = require("../util/account-cascade");
RecipeSchema.plugin(accountCascade, {
  owners: ["userId"],
  keep: (userId) => require("./recipe-dao").releaseOwnRecipes(userId),
  authorship: ["assignedByTrainerId"],
  stage: STAGE.catalog,
});

module.exports = mongoose.model("Recipe", RecipeSchema);
