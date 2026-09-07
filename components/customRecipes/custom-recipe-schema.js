const mongoose = require("mongoose");
const Schema = mongoose.Schema;

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
      min: 0,
      default: null,
    },
    quantityCooked: {
      type: Number,
      min: 0,
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
    // Pautado por trainer — mismo criterio que Meal.assignedByTrainerId /
    // CustomProduct.assignedByTrainerId (ver esos comentarios). Permanente,
    // protege de borrado/edición directa del cliente.
    assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // Cantidad ORIGINAL pautada (gramos) — mismo criterio que
    // CustomProduct.assignedQuantity (ver ese comentario): se estampa una
    // vez junto con assignedByTrainerId y no vuelve a tocarse; `quantity`
    // pasa a ser la cantidad consumida, editable por el cliente.
    assignedQuantity: { type: Number, min: 0, default: null },
    // El cliente lo marca como tomado — nunca bloqueado por assignedByTrainerId.
    consumed: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    strict: true,
  },
);

CustomRecipeSchema.plugin(require("mongoose-autopopulate"));

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
