const customRecipeSchema = require("./custom-recipe-schema");
const recipeMergeService = require("../recipes/recipe-merge.service");

module.exports = {
  async getCustomRecipeById(id) {
    return customRecipeSchema.findById(id);
  },

  async searchCustomRecipe(page, limit, search) {
    const query = search
      ? {
          $or: [
            { "recipe.name": { $regex: search, $options: "i" } },
            { name: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    return customRecipeSchema
      .find(query)
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async createCustomRecipe(customRecipe) {
    recipeMergeService.validateCustomRecipe(customRecipe);
    const created = await customRecipeSchema.create(customRecipe);
    return customRecipeSchema.findById(created._id);
  },

  async update(id, updateData) {
    const current = await customRecipeSchema.findById(id);
    if (!current) {
      throw new Error(`CustomRecipe not found: ${id}`);
    }

    const nextValue = {
      ...current.toObject(),
      ...updateData,
      recipe: current.recipe,
      quantity: recipeMergeService.normalizePositiveNumber(
        updateData.quantity === undefined ? current.quantity : updateData.quantity,
      ),
      quantityCooked: recipeMergeService.normalizePositiveNumber(
        updateData.quantityCooked === undefined
          ? current.quantityCooked
          : updateData.quantityCooked,
      ),
    };

    recipeMergeService.validateCustomRecipe(nextValue);

    return customRecipeSchema.findByIdAndUpdate(
      id,
      {
        $set: {
          quantity:
            recipeMergeService.normalizePositiveNumber(
              updateData.quantity === undefined
                ? current.quantity
                : updateData.quantity,
            ),
          quantityCooked:
            recipeMergeService.normalizePositiveNumber(
              updateData.quantityCooked === undefined
                ? current.quantityCooked
                : updateData.quantityCooked,
            ),
          addedCustomProducts:
            updateData.addedCustomProducts === undefined
              ? current.addedCustomProducts
              : updateData.addedCustomProducts,
          modifiedBaseCustomProducts:
            updateData.modifiedBaseCustomProducts === undefined
              ? current.modifiedBaseCustomProducts
              : updateData.modifiedBaseCustomProducts,
          removedBaseCustomProductIds:
            updateData.removedBaseCustomProductIds === undefined
              ? current.removedBaseCustomProductIds
              : updateData.removedBaseCustomProductIds,
        },
      },
      { new: true },
    );
  },

  async delete(id) {
    const deleted = await customRecipeSchema.findByIdAndDelete(id);
    if (!deleted) {
      throw new Error(`CustomRecipe not found: ${id}`);
    }
    return { success: true };
  },
};
