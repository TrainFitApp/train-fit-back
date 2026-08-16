const mealSnippetSchema = require("./meal-snippet-schema");
const mealSchema = require("../meals/meal-schema");

module.exports = {
  async create(trainerId, name) {
    const meal = await mealSchema.create({ name, customProducts: [], customRecipes: [] });
    return mealSnippetSchema.create({ trainerId, name, meal: meal._id });
  },

  async findById(id) {
    return mealSnippetSchema.findById(id);
  },

  async findByIdPopulated(id) {
    return mealSnippetSchema
      .findById(id)
      .populate({
        path: "meal",
        populate: { path: "customProducts", populate: { path: "product" } },
      })
      .lean();
  },

  async findByTrainer(trainerId, search) {
    const query = { trainerId };
    if (search) query.name = { $regex: search, $options: "i" };
    return mealSnippetSchema.find(query).sort({ _id: -1 }).lean();
  },

  async updateName(id, name) {
    await mealSnippetSchema.findByIdAndUpdate(id, { $set: { name } });
    const snippet = await mealSnippetSchema.findById(id);
    if (snippet) await mealSchema.findByIdAndUpdate(snippet.meal, { $set: { name } });
    return snippet;
  },

  async deleteSnippet(id) {
    const snippet = await mealSnippetSchema.findById(id).lean();
    if (snippet) await mealSchema.deleteOne({ _id: snippet.meal });
    return mealSnippetSchema.deleteOne({ _id: id });
  },
};
