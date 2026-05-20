const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ProductSchema = Schema({
  code: String,
  name: String,
  brand: String,
  nameNormalized: String,
  brandNormalized: String,
  namePrefixes: [String],
  brandPrefixes: [String],

  // Basic macronutrients
  calcium100g: Number,
  carbohydrates100g: Number,
  cholesterol100g: Number,
  energyKcal100g: Number,
  fat100g: Number,
  fiber100g: Number,
  iron100g: Number,
  protein100g: Number,
  salt100g: Number,
  saturatedFat100g: Number,
  sodium100g: Number,
  sugars100g: Number,
  transFat100g: Number,
  vitaminA100g: Number,
  vitaminC100g: Number,

  // Additional minerals (stored in grams, displayed in mg/µg)
  magnesium100g: Number,
  phosphorus100g: Number,
  potassium100g: Number,
  zinc100g: Number,
  copper100g: Number,
  manganese100g: Number,
  selenium100g: Number,
  iodine100g: Number,

  // Additional vitamins (stored in grams, displayed in mg/µg)
  vitaminB1100g: Number, // Thiamin
  vitaminB2100g: Number, // Riboflavin
  vitaminB3100g: Number, // Niacin
  vitaminB5100g: Number, // Pantothenic acid
  vitaminB6100g: Number,
  vitaminB9100g: Number, // Folate
  vitaminB12100g: Number,
  vitaminD100g: Number,
  vitaminE100g: Number,
  vitaminK100g: Number,
  biotin100g: Number, // Vitamin B7

  // Fatty acids (in grams)
  omega3100g: Number,
  omega6100g: Number,
  omega9100g: Number,

  // Other nutrients
  caffeine100g: Number,
  taurine100g: Number,
  alcohol100g: Number,

  // Product information
  servingUnit: String,
  ingredients: String,

  // Allergens and dietary characteristics
  allergens: [String],
  traces: [String],
  vegan: Boolean,
  vegetarian: Boolean,
  lactoseFree: Boolean,
  glutenFree: Boolean,

  // Nutriscore & serving
  nutriscoreScore: Number,
  nutriscoreGrade: String,
  productQuantity: Number,
  servingQuantity: Number,
  verified: Boolean,

  // Owner: if set, this product was created by the user (replaces OwnProduct)
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

// ─── INDEXES ───────────────────────────────────────────────────────────
// All product indexes are managed by: scripts/rebuild-product-indexes.js
// Run:  npm run rebuild:product-indexes
// Do NOT define indexes here — the script is the single source of truth.
// ───────────────────────────────────────────────────────────────────────

// ─── Shared cascade logic (single | bulk) ──────────────────────────────
async function cascadeDeleteProducts(productIds) {
  if (!productIds.length) return;

  // Remove from archivedProducts in users that have them favorited
  try {
    const UserModel = mongoose.model("User");
    await UserModel.updateMany(
      { archivedProducts: { $in: productIds } },
      { $pull: { archivedProducts: { $in: productIds } } },
    );
  } catch (e) {
    console.warn("[ProductSchema] Error updating archivedProducts", e);
  }

  // Clean up CustomProducts referencing any of these products
  try {
    const customProductSchema = require("../customProducts/custom-product-schema");
    let customProducts = await customProductSchema
      .find({ product: { $in: productIds } })
      .lean();

    if (customProducts.length > 0) {
      let cpIds = customProducts.map((cp) => cp._id);
      const dependentCustomProducts = await customProductSchema
        .find({ baseCustomProductId: { $in: cpIds } })
        .lean();

      if (dependentCustomProducts.length > 0) {
        customProducts = customProducts.concat(dependentCustomProducts);
        cpIds = customProducts.map((cp) => cp._id);
      }

      try {
        const MealModel = mongoose.model("Meal");
        await MealModel.updateMany(
          { customProducts: { $in: cpIds } },
          { $pull: { customProducts: { $in: cpIds } } },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error updating meals", e);
      }
      try {
        const RecipeModel = mongoose.model("Recipe");
        await RecipeModel.updateMany(
          { customProducts: { $in: cpIds } },
          { $pull: { customProducts: { $in: cpIds } } },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error updating recipes", e);
      }
      try {
        const CustomRecipeModel = mongoose.model("CustomRecipe");
        await CustomRecipeModel.updateMany(
          {
            $or: [
              { addedCustomProducts: { $in: cpIds } },
              { modifiedBaseCustomProducts: { $in: cpIds } },
              { removedBaseCustomProductIds: { $in: cpIds } },
            ],
          },
          {
            $pull: {
              addedCustomProducts: { $in: cpIds },
              modifiedBaseCustomProducts: { $in: cpIds },
              removedBaseCustomProductIds: { $in: cpIds },
            },
          },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error cleaning CustomRecipes", e);
      }
      await customProductSchema.deleteMany({ _id: { $in: cpIds } });
    }

    // Legacy cleanup for CustomRecipes with embedded added ingredients.
    try {
      const CustomRecipeModel = mongoose.model("CustomRecipe");
      await CustomRecipeModel.updateMany(
        { addedCustomProducts: { $elemMatch: { product: { $in: productIds } } } },
        { $pull: { addedCustomProducts: { product: { $in: productIds } } } },
      );
    } catch (e) {
      console.warn("[ProductSchema] Error cleaning addedCustomProducts", e);
    }
  } catch (e) {
    console.warn("[ProductSchema] Error cleaning up CustomProducts", e);
  }
}

// ─── Hooks ─────────────────────────────────────────────────────────────
const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const product = await this.model.findOne(query);
    if (!product) return next();
    await cascadeDeleteProducts([product._id]);
    next();
  } catch (error) {
    next(error);
  }
};

const handleDeleteMany = async function (next) {
  try {
    const query = this.getQuery();
    const products = await this.model.find(query).lean();
    if (!products.length) return next();
    await cascadeDeleteProducts(products.map((p) => p._id));
    next();
  } catch (error) {
    next(error);
  }
};

ProductSchema.pre("deleteOne", handleDeleteOne);
ProductSchema.pre("findOneAndDelete", handleDeleteOne);
ProductSchema.pre("findOneAndRemove", handleDeleteOne);
ProductSchema.pre("deleteMany", handleDeleteMany);

module.exports = mongoose.model("Product", ProductSchema);
