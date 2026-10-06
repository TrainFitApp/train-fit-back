const mongoose = require("mongoose");
const DietDay = require("../dietDays/diet-days-schema");
const User = require("../users/user-schema");
const { buildHiddenRecentStages } = require("./recent-food-match");

// Los recientes de una comida NO se guardan: salen de recorrer los días de
// dieta del usuario. Sin acotar, el pipeline desplegaba TODAS sus comidas y
// TODOS sus alimentos de siempre para quedarse con 15. Se limita a los días
// más recientes, que es de donde pueden salir: `date` es "YYYY-MM-DD", así
// que el orden de cadena es el cronológico y el índice {userId, date} sirve
// para el $sort.
const RECENT_DAYS_SCANNED = 120;

function recentMealStages(userId, mealIndex) {
  return [
    { $match: { userId } },
    { $sort: { date: -1 } },
    { $limit: RECENT_DAYS_SCANNED },
    // Las comidas van en el orden de los huecos: la comida `mealIndex` es
    // directamente meals[mealIndex].
    { $project: { date: 1, meal: { $arrayElemAt: ["$meals", mealIndex] } } },
    { $match: { meal: { $ne: null } } },
  ];
}

module.exports = {
  // Lo que el usuario ha quitado de los recientes de esa comida y pestaña
  // (User.hiddenRecentFoods).
  async listHidden(userId, mealIndex, kind) {
    const user = await User.findById(userId).select("hiddenRecentFoods").lean();
    return (user?.hiddenRecentFoods || []).filter((entry) => entry.mealIndex === mealIndex && entry.kind === kind);
  },

  async listRecentProducts(userId, mealIndex, limit, hidden) {
    const pipeline = [
      ...recentMealStages(new mongoose.Types.ObjectId(String(userId)), mealIndex),
      { $unwind: { path: "$meal.customProducts", includeArrayIndex: "customProductIndex" } },
      { $addFields: { customProduct: "$meal.customProducts" } },
      ...buildHiddenRecentStages(hidden, { refField: "customProduct.product", entryIdField: "customProduct._id" }),
      // Una adición rápida no tiene producto detrás: no es un reciente.
      { $lookup: { from: "products", localField: "customProduct.product", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      { $sort: { date: -1, customProductIndex: -1, "customProduct._id": -1 } },
      {
        $group: {
          _id: "$product._id",
          customProduct: { $first: "$customProduct" },
          product: { $first: "$product" },
          lastUsedAt: { $first: "$date" },
        },
      },
      { $sort: { lastUsedAt: -1 } },
      { $limit: limit },
      { $addFields: { "customProduct.product": "$product", "customProduct.lastUsedAt": "$lastUsedAt" } },
      { $replaceRoot: { newRoot: "$customProduct" } },
    ];
    return DietDay.aggregate(pipeline).exec();
  },

  async listRecentRecipes(userId, mealIndex, limit, hidden) {
    const pipeline = [
      ...recentMealStages(new mongoose.Types.ObjectId(String(userId)), mealIndex),
      { $unwind: { path: "$meal.customRecipes", includeArrayIndex: "customRecipeIndex" } },
      { $addFields: { customRecipe: "$meal.customRecipes" } },
      ...buildHiddenRecentStages(hidden, { refField: "customRecipe.recipe", entryIdField: "customRecipe._id" }),
      { $sort: { date: -1, customRecipeIndex: -1, "customRecipe._id": -1 } },
      {
        $group: {
          _id: "$customRecipe.recipe",
          customRecipe: { $first: "$customRecipe" },
          lastUsedAt: { $first: "$date" },
        },
      },
      { $sort: { lastUsedAt: -1 } },
      { $limit: limit },
    ];
    const rows = await DietDay.aggregate(pipeline).exec();
    if (!rows.length) return [];

    // La receta va embebida en la comida: se puebla aquí (la Recipe con sus
    // ingredientes y el Product de cada ingrediente añadido o cambiado).
    const customRecipes = rows.map((row) => ({ ...row.customRecipe, lastUsedAt: row.lastUsedAt || null }));
    const Recipe = mongoose.model("Recipe");
    const recipes = await Recipe.find({ _id: { $in: customRecipes.map((cr) => cr.recipe) } }).lean({ autopopulate: true });
    const recipeById = new Map(recipes.map((recipe) => [String(recipe._id), recipe]));
    await mongoose.model("Product").populate(customRecipes, [
      { path: "addedCustomProducts.product", model: "Product", options: { lean: true } },
      { path: "modifiedBaseCustomProducts.product", model: "Product", options: { lean: true } },
    ]);
    return customRecipes.map((cr) => ({ ...cr, recipe: recipeById.get(String(cr.recipe)) || cr.recipe }));
  },

  // Ocultar unos cuantos: cada uno con su hora (si ya estaba oculto, se
  // actualiza la hora).
  async hideItems(userId, mealIndex, kind, refIds, hiddenAt) {
    const wanted = new Set(refIds.map(String));
    await User.updateOne(
      { _id: userId },
      { $pull: { hiddenRecentFoods: { mealIndex, kind, refId: { $in: [...wanted].map((id) => new mongoose.Types.ObjectId(id)) } } } },
    );
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          hiddenRecentFoods: {
            $each: [...wanted].map((refId) => ({ mealIndex, kind, refId: new mongoose.Types.ObjectId(refId), hiddenAt })),
          },
        },
      },
    );
  },

  // «Borrar todos»: un solo corte por hora (refId null). Los ocultos sueltos
  // de esa comida y pestaña quedan cubiertos por él y se quitan.
  async hideAll(userId, mealIndex, kind, hiddenAt) {
    await User.updateOne({ _id: userId }, { $pull: { hiddenRecentFoods: { mealIndex, kind } } });
    await User.updateOne(
      { _id: userId },
      { $push: { hiddenRecentFoods: { mealIndex, kind, refId: null, hiddenAt } } },
    );
  },

  async restoreItems(userId, mealIndex, kind, refIds) {
    await User.updateOne(
      { _id: userId },
      {
        $pull: {
          hiddenRecentFoods: { mealIndex, kind, refId: { $in: refIds.map((id) => new mongoose.Types.ObjectId(String(id))) } },
        },
      },
    );
  },
};
