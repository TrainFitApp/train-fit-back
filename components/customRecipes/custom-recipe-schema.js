const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { LIMITS, applyRunValidators } = require("../util/validation-limits");

const normalizeCustomProductId = (value) => {
  const normalized = value?._id || value;
  return normalized?.toString?.() || null;
};

const deleteIngredientCustomProducts = async (customRecipes) => {
  const ids = [];

  for (const customRecipe of customRecipes || []) {
    ids.push(
      ...(customRecipe?.addedCustomProducts || []),
      ...(customRecipe?.modifiedBaseCustomProducts || []),
    );
  }

  const normalizedIds = ids.map(normalizeCustomProductId).filter(Boolean);
  if (!normalizedIds.length) return;

  const CustomProduct = mongoose.model("CustomProduct");
  await CustomProduct.deleteMany({ _id: { $in: normalizedIds } });
};

const CustomRecipeSchema = new Schema(
  {
    recipe: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      autopopulate: true,
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      min: LIMITS.nutrition.quantityMin,
      max: LIMITS.nutrition.quantityMax,
      default: null,
    },
    quantityCooked: {
      type: Number,
      min: LIMITS.nutrition.quantityMin,
      max: LIMITS.nutrition.quantityMax,
      default: null,
    },
    addedCustomProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "CustomProduct",
        autopopulate: true,
      },
    ],
    modifiedBaseCustomProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "CustomProduct",
        autopopulate: true,
      },
    ],
    removedBaseCustomProductIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "CustomProduct",
      },
    ],
  },
  {
    timestamps: true,
    strict: true,
  },
);

CustomRecipeSchema.plugin(require("mongoose-autopopulate"));
applyRunValidators(CustomRecipeSchema);

const handleDeleteOne = async function (next) {
  try {
    const customRecipe = await this.model
      .findOne(this.getQuery())
      .select("addedCustomProducts modifiedBaseCustomProducts")
      .setOptions({ autopopulate: false });

    if (customRecipe) {
      await deleteIngredientCustomProducts([customRecipe]);
    }

    next();
  } catch (error) {
    next(error);
  }
};

CustomRecipeSchema.pre(
  "deleteOne",
  { document: false, query: true },
  handleDeleteOne,
);
CustomRecipeSchema.pre("findOneAndDelete", handleDeleteOne);
CustomRecipeSchema.pre("findOneAndRemove", handleDeleteOne);

CustomRecipeSchema.pre("deleteMany", async function (next) {
  try {
    const customRecipes = await this.model
      .find(this.getFilter())
      .select("addedCustomProducts modifiedBaseCustomProducts")
      .setOptions({ autopopulate: false });

    await deleteIngredientCustomProducts(customRecipes);
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("CustomRecipe", CustomRecipeSchema);
