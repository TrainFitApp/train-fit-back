const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  LIMITS,
  stringField,
  numberField,
  stringArrayField,
  applyRunValidators,
} = require("../util/validation-limits");

const ProductSchema = Schema({
  code: stringField(LIMITS.text.barcodeMax),
  name: stringField(
    LIMITS.text.productNameMax,
    false,
    LIMITS.text.shortNameMin,
  ),
  brand: stringField(LIMITS.text.brandMax),
  nameNormalized: String,
  brandNormalized: String,
  namePrefixes: [String],
  brandPrefixes: [String],

  // Basic macronutrients
  calcium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  carbohydrates100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  cholesterol100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  energyKcal100g: numberField(LIMITS.nutrition.kcal100gMin, LIMITS.nutrition.kcal100gMax),
  fat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  fiber100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  iron100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  protein100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  salt100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  saturatedFat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  sodium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  sugars100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  transFat100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  vitaminA100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminC100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),

  // Additional minerals (stored in grams, displayed in mg/µg)
  magnesium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  phosphorus100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  potassium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  zinc100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  copper100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  manganese100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  selenium100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  iodine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),

  // Additional vitamins (stored in grams, displayed in mg/µg)
  vitaminB1100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Thiamin
  vitaminB2100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Riboflavin
  vitaminB3100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Niacin
  vitaminB5100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Pantothenic acid
  vitaminB6100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminB9100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Folate
  vitaminB12100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminD100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminE100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  vitaminK100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  biotin100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax), // Vitamin B7

  // Fatty acids (in grams)
  omega3100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  omega6100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),
  omega9100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),

  // Other nutrients
  caffeine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  taurine100g: numberField(LIMITS.nutrition.storedMicroMin, LIMITS.nutrition.storedMicroMax),
  alcohol100g: numberField(LIMITS.nutrition.grams100gMin, LIMITS.nutrition.grams100gMax),

  // Product information
  servingUnit: String,
  ingredients: stringField(LIMITS.text.ingredientsMax),

  // Allergens and dietary characteristics
  allergens: stringArrayField(LIMITS.text.allergensMax),
  traces: stringArrayField(LIMITS.text.allergensMax),
  vegan: Boolean,
  vegetarian: Boolean,
  lactoseFree: Boolean,
  glutenFree: Boolean,

  // Nutriscore & serving
  nutriscoreScore: Number,
  nutriscoreGrade: String,
  productQuantity: numberField(LIMITS.nutrition.quantityMin, LIMITS.nutrition.quantityMax),
  servingQuantity: numberField(LIMITS.nutrition.quantityMin, LIMITS.nutrition.quantityMax),
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
applyRunValidators(ProductSchema);

module.exports = mongoose.model("Product", ProductSchema);
