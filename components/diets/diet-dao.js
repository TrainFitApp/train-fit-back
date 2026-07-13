const dietSchema = require("./diet-schema");
const userSchema = require("../users/schema");
const mongoose = require("mongoose");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  async getDiets(page, limit) {
    return new Promise((resolve, reject) =>
      dietSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        })
    );
  },

  async getDietById(id) {
    return new Promise((resolve, reject) =>
      dietSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
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

    const pipeline = [
      { $match: { _id: dietObjectId } },
      { $project: { dietsDay: 1 } },
      { $unwind: "$dietsDay" },
      {
        $lookup: {
          from: "dietdays",
          localField: "dietsDay",
          foreignField: "_id",
          as: "dietDay",
        },
      },
      { $unwind: "$dietDay" },
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

    return dietSchema.aggregate(pipeline).exec();
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

    const pipeline = [
      { $match: { _id: dietObjectId } },
      { $project: { dietsDay: 1 } },
      { $unwind: "$dietsDay" },
      {
        $lookup: {
          from: "dietdays",
          localField: "dietsDay",
          foreignField: "_id",
          as: "dietDay",
        },
      },
      { $unwind: "$dietDay" },
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

    const results = await dietSchema.aggregate(pipeline).exec();
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

  async getSearchDiets(page, limit, search) {
    return new Promise((resolve, reject) =>
      dietSchema
        .find({ name: { $regex: search, $options: "i" } })
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        })
    );
  },

  async createDiet(diet) {
    return new Promise((resolve, reject) =>
      dietSchema.create(diet, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async addDietDietDay(idDiet, idDietDay) {
    const addDietDay = {
      $push: { dietsDay: idDietDay },
    };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(
        idDiet,
        addDietDay,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }
      )
    );
  },

  async addDietUser(idUser, idDiet) {
    const addDiet = {
      $push: { diets: idDiet },
    };

    return new Promise((resolve, reject) =>
      userSchema.findByIdAndUpdate(idUser, addDiet, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async updateDiet(id, { name, dietsDay }) {
    const update = { $set: { name, dietsDay } };

    return new Promise((resolve, reject) =>
      dietSchema.updateOne({ _id: id }, update, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async updatePinnedNote(id, notes) {
    const update = notes
      ? { $set: { pinnedNote: notes } }
      : { $unset: { pinnedNote: "" } };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(id, update, { new: true }, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async deleteUser(id) {
    return new Promise((resolve, reject) =>
      dietSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async deleteDietDietDay(idDiet, idDietDay) {
    const deleteDietDay = {
      $pull: { dietDays: idDietDay },
    };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(idDiet, deleteDietDay, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async deleteDiet(id) {
    try {
      return await dietSchema.deleteOne({ _id: id });
    } catch (err) {
      throw err;
    }
  },
};
