const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeInstanceSchema = require("../customRecipes/custom-recipe-schema");
const dataRecipeSchema = require("../dataRecipes/data-recipe-schema");

const MealSchema = Schema({
  name: String,
  notes: String,
  customProducts: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomProduct",
      autopopulate: true,
    },
  ],
  customRecipeInstances: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomRecipe", // Note: model name is "CustomRecipe" but it's CustomRecipeInstance
      autopopulate: true,
    },
  ],
});

MealSchema.plugin(mongooseAutopopulate);

const handleDelete = async function (next) {
  try {
    const query = this.getQuery();
    const meal = await this.model.findOne(query);
    if (!meal) return next();

    const customProductIds = meal.customProducts || [];
    const customRecipeInstanceIds = meal.customRecipeInstances || [];

    // Pre-calculate dataRecipeIds before deleting instances
    const customRecipeInstances = await customRecipeInstanceSchema
      .find({ _id: { $in: customRecipeInstanceIds } }, "dataRecipe")
      .lean();
    const dataRecipeIds = customRecipeInstances
      .map((cri) => cri.dataRecipe)
      .filter(Boolean);

    // Perform deletions
    await customProductSchema.deleteMany({ _id: { $in: customProductIds } });
    await customRecipeInstanceSchema.deleteMany({
      _id: { $in: customRecipeInstanceIds },
    });
    await dataRecipeSchema.deleteMany({ _id: { $in: dataRecipeIds } });
    
    next();
  } catch (error) {
    next(error);
  }
};

MealSchema.pre("deleteOne", handleDelete);
MealSchema.pre("findOneAndDelete", handleDelete);
MealSchema.pre("findOneAndRemove", handleDelete);

MealSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const mealsPToDelete = await this.model.find(filter, "customProducts");
    const mealsRToDelete = await this.model.find(
      filter,
      "customRecipeInstances",
    );
    const customProductsIds = mealsPToDelete.flatMap(
      (meal) => meal.customProducts,
    );
    const customRecipeInstancesIds = mealsRToDelete.flatMap(
      (meal) => meal.customRecipeInstances,
    );
    const customRecipeInstances = await customRecipeInstanceSchema
      .find({ _id: { $in: customRecipeInstancesIds } }, "dataRecipe")
      .lean();
    const dataRecipeIds = customRecipeInstances
      .map((cri) => cri.dataRecipe)
      .filter(Boolean);
    await customProductSchema.deleteMany({ _id: { $in: customProductsIds } });
    await customRecipeInstanceSchema.deleteMany({
      _id: { $in: customRecipeInstancesIds },
    });
    await dataRecipeSchema.deleteMany({ _id: { $in: dataRecipeIds } });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Meal", MealSchema);
