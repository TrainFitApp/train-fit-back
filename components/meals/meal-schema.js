const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

const MealSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 500 },
  // TAREA 1 (coach-tab) — presente si un profesional pautó esta comida
  // (prescribeMeal). Mismo criterio que Table/NutritionalGoal.assignedByTrainerId:
  // permanente, protege de edición directa del cliente (ver
  // meal-service.js#assertMealEditable) — la única vía controlada para
  // cambiarla es una MealProposal nueva del propio profesional.
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // El cliente la marca como comida cuando la ha tomado — no bloqueado por
  // assignedByTrainerId (marcar cumplimiento siempre está permitido, solo se
  // protege la COMPOSICIÓN de la comida, no su registro de seguimiento).
  completed: { type: Boolean, default: false },
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
