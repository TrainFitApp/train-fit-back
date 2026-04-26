const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

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
  customRecipes: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomRecipe",
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
    const customRecipeIds = meal.customRecipes || [];

    // Perform deletions
    await customProductSchema.deleteMany({ _id: { $in: customProductIds } });
    await customRecipeSchema.deleteMany({
      _id: { $in: customRecipeIds },
    });

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
      "customRecipes",
    );
    const customProductsIds = mealsPToDelete.flatMap(
      (meal) => meal.customProducts,
    );
    const customRecipeIds = mealsRToDelete.flatMap(
      (meal) => meal.customRecipes,
    );
    await customProductSchema.deleteMany({ _id: { $in: customProductsIds } });
    await customRecipeSchema.deleteMany({
      _id: { $in: customRecipeIds },
    });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Meal", MealSchema);
