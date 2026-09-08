const dietDaySchema = require("../dietDays/diet-days-schema");
const userSchema = require("../users/schema");
const mongoose = require("mongoose");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

// Refactor nutrición (2026-09) — la colección `diets` ya no existe. Este
// componente sobrevive SOLO como capa de compatibilidad para las apps ya
// instaladas, que siguen llamando a /diets/... con lo que ellas creen que es
// un dietId y en realidad ya es el id del propio usuario (ver users/dto.js).
// No tiene schema ni modelo propio: todo se resuelve contra users y dietdays.
module.exports = {
  // El único campo del wrapper con contenido real. Vive ahora en el usuario.
  async getDietById(id) {
    const user = await userSchema.findById(id).select("dietPinnedNote").lean();
    if (!user) return null;
    return { _id: user._id, name: "Diet", pinnedNote: user.dietPinnedNote || "", dietsDay: [] };
  },

  async updatePinnedNote(id, notes) {
    const user = await userSchema
      .findByIdAndUpdate(id, { $set: { dietPinnedNote: notes } }, { new: true })
      .select("dietPinnedNote")
      .lean();
    if (!user) return null;
    return { _id: user._id, name: "Diet", pinnedNote: user.dietPinnedNote || "", dietsDay: [] };
  },

  // Sin wrapper no hay array al que enganchar el día: el día ya nace con su
  // userId. Se mantiene para que la llamada antigua no devuelva 404.
  async addDietDietDay(idDiet) {
    return this.getDietById(idDiet);
  },

  async getRecentMealProducts(
    id,
    { mealIndex, limit = 15 } = {}
  ) {
    const dietObjectId = toObjectId(id);
    if (!dietObjectId) return [];

    const normalizedMealIndex = parseInt((mealIndex || 0).toString(), 10);
    if (!Number.isInteger(normalizedMealIndex) || normalizedMealIndex < 0) {
      return [];
    }

    const normalizedLimit = Math.min(
      Math.max(parseInt((limit || 15).toString(), 10) || 15, 1),
      15
    );

    // Refactor nutrición (2026-09) — arranca en dietdays filtrando por dueño
    // (el id que manda el cliente ya es el del usuario, ver users/dto.js) en
    // vez de en el wrapper Diet. $dietDay se conserva como nombre de campo
    // para no reescribir el resto del pipeline.
    const pipeline = [
      { $match: { userId: dietObjectId } },
      { $addFields: { dietDay: "$$ROOT" } },
      {
        $addFields: {
          mealId: { $arrayElemAt: ["$dietDay.meals", normalizedMealIndex] },
        },
      },
      { $match: { mealId: { $ne: null } } },
      {
        $lookup: {
          from: "meals",
          localField: "mealId",
          foreignField: "_id",
          as: "meal",
        },
      },
      { $unwind: "$meal" },
      {
        $unwind: {
          path: "$meal.customProducts",
          includeArrayIndex: "customProductIndex",
        },
      },
      {
        $lookup: {
          from: "customproducts",
          localField: "meal.customProducts",
          foreignField: "_id",
          as: "customProduct",
        },
      },
      { $unwind: "$customProduct" },
      {
        $lookup: {
          from: "products",
          localField: "customProduct.product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $sort: {
          "dietDay.date": -1,
          customProductIndex: -1,
          "customProduct._id": -1,
        },
      },
      {
        $group: {
          _id: "$product._id",
          customProduct: { $first: "$customProduct" },
          product: { $first: "$product" },
          lastUsedAt: { $first: "$dietDay.date" },
        },
      },
      { $sort: { lastUsedAt: -1 } },
      { $limit: normalizedLimit },
      {
        $addFields: {
          "customProduct.product": "$product",
          "customProduct.lastUsedAt": "$lastUsedAt",
        },
      },
      { $replaceRoot: { newRoot: "$customProduct" } },
    ];

    return dietDaySchema.aggregate(pipeline).exec();
  },

  async getRecentMealRecipes(
    id,
    { mealIndex, limit = 15 } = {}
  ) {
    const dietObjectId = toObjectId(id);
    if (!dietObjectId) return [];

    const normalizedMealIndex = parseInt((mealIndex || 0).toString(), 10);
    if (!Number.isInteger(normalizedMealIndex) || normalizedMealIndex < 0) {
      return [];
    }

    const normalizedLimit = Math.min(
      Math.max(parseInt((limit || 15).toString(), 10) || 15, 1),
      15
    );

    // Refactor nutrición (2026-09) — arranca en dietdays filtrando por dueño
    // (el id que manda el cliente ya es el del usuario, ver users/dto.js) en
    // vez de en el wrapper Diet. $dietDay se conserva como nombre de campo
    // para no reescribir el resto del pipeline.
    const pipeline = [
      { $match: { userId: dietObjectId } },
      { $addFields: { dietDay: "$$ROOT" } },
      {
        $addFields: {
          mealId: { $arrayElemAt: ["$dietDay.meals", normalizedMealIndex] },
        },
      },
      { $match: { mealId: { $ne: null } } },
      {
        $lookup: {
          from: "meals",
          localField: "mealId",
          foreignField: "_id",
          as: "meal",
        },
      },
      { $unwind: "$meal" },
      {
        $unwind: {
          path: "$meal.customRecipes",
          includeArrayIndex: "customRecipeIndex",
        },
      },
      {
        $lookup: {
          from: "customrecipes",
          localField: "meal.customRecipes",
          foreignField: "_id",
          as: "customRecipe",
        },
      },
      { $unwind: "$customRecipe" },
      {
        $sort: {
          "dietDay.date": -1,
          customRecipeIndex: -1,
          "customRecipe._id": -1,
        },
      },
      {
        $group: {
          _id: "$customRecipe.recipe",
          customRecipeId: { $first: "$customRecipe._id" },
          lastUsedAt: { $first: "$dietDay.date" },
        },
      },
      { $sort: { lastUsedAt: -1 } },
      { $limit: normalizedLimit },
    ];

    const results = await dietDaySchema.aggregate(pipeline).exec();
    if (results.length === 0) return [];

    const topRecipeIds = results.map((r) => r.customRecipeId);
    const lastUsedMap = {};
    results.forEach((r) => {
      lastUsedMap[r.customRecipeId.toString()] = r.lastUsedAt;
    });

    const CustomRecipe = mongoose.model("CustomRecipe");
    const customRecipes = await CustomRecipe.find({
      _id: { $in: topRecipeIds },
    })
      .populate({
        path: "recipe",
        populate: {
          path: "customProducts",
          populate: { path: "product" },
        },
      })
      .populate({ path: "addedCustomProducts", populate: { path: "product" } })
      .populate({
        path: "modifiedBaseCustomProducts",
        populate: { path: "product" },
      })
      .lean();

    const sorted = topRecipeIds
      .map((id) => {
        const doc = customRecipes.find(
          (cr) => cr._id.toString() === id.toString(),
        );
        if (doc) {
          doc.lastUsedAt = lastUsedMap[id.toString()] || null;
        }
        return doc;
      })
      .filter(Boolean);

    return sorted;
  },
};
