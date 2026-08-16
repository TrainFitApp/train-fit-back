const mealSnippetDao = require("./meal-snippet-dao");
const customProductDao = require("../customProducts/custom-product-dao");
const mealSchema = require("../meals/meal-schema");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function requireOwnedSnippet(trainerId, snippetId) {
  const snippet = await mealSnippetDao.findById(snippetId);
  if (!snippet || String(snippet.trainerId) !== String(trainerId)) {
    throw makeError(404, "SNIPPET_NOT_FOUND", "Snippet no encontrado");
  }
  return snippet;
}

module.exports = {
  async listMine(trainerId, search) {
    return mealSnippetDao.findByTrainer(trainerId, search);
  },

  async create(trainerId, name) {
    if (!name || !name.trim()) {
      throw makeError(400, "NAME_REQUIRED", "El nombre es obligatorio");
    }
    return mealSnippetDao.create(trainerId, name.trim());
  },

  async getMine(trainerId, snippetId) {
    await requireOwnedSnippet(trainerId, snippetId);
    return mealSnippetDao.findByIdPopulated(snippetId);
  },

  async rename(trainerId, snippetId, name) {
    await requireOwnedSnippet(trainerId, snippetId);
    if (!name || !name.trim()) {
      throw makeError(400, "NAME_REQUIRED", "El nombre es obligatorio");
    }
    return mealSnippetDao.updateName(snippetId, name.trim());
  },

  async remove(trainerId, snippetId) {
    await requireOwnedSnippet(trainerId, snippetId);
    return mealSnippetDao.deleteSnippet(snippetId);
  },

  async addCustomProduct(trainerId, snippetId, customProductPayload) {
    const snippet = await requireOwnedSnippet(trainerId, snippetId);
    return customProductDao.createCustomProductAndAddToMeal(
      snippet.meal,
      customProductPayload,
      trainerId
    );
  },

  async removeCustomProduct(trainerId, snippetId, customProductId) {
    const snippet = await requireOwnedSnippet(trainerId, snippetId);
    await mealSchema.findByIdAndUpdate(snippet.meal, {
      $pull: { customProducts: customProductId },
    });
    return customProductDao.delete(customProductId);
  },
};
