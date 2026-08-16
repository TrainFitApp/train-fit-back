const mealSnippetService = require("./meal-snippet-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[MEAL_SNIPPETS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async list(req, res) {
    const snippets = await mealSnippetService.listMine(req.user.id, req.query.search);
    return res.send(snippets);
  },

  async create(req, res) {
    try {
      const snippet = await mealSnippetService.create(req.user.id, req.body?.name);
      return res.status(201).send(snippet);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getById(req, res) {
    try {
      const snippet = await mealSnippetService.getMine(req.user.id, req.params.id);
      return res.send(snippet);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async rename(req, res) {
    try {
      const snippet = await mealSnippetService.rename(req.user.id, req.params.id, req.body?.name);
      return res.send(snippet);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async remove(req, res) {
    try {
      await mealSnippetService.remove(req.user.id, req.params.id);
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addCustomProduct(req, res) {
    try {
      const customProduct = await mealSnippetService.addCustomProduct(
        req.user.id,
        req.params.id,
        req.body?.customProduct
      );
      return res.status(201).send(customProduct);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async removeCustomProduct(req, res) {
    try {
      await mealSnippetService.removeCustomProduct(
        req.user.id,
        req.params.id,
        req.params.customProductId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
