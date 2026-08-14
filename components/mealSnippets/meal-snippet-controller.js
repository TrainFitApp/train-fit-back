const mealSnippetDao = require("./meal-snippet-dao");

module.exports = {
  async createSnippet(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const customProducts = Array.isArray(req.body?.customProducts) ? req.body.customProducts : [];
    const customRecipes = Array.isArray(req.body?.customRecipes) ? req.body.customRecipes : [];
    if (!customProducts.length && !customRecipes.length) {
      return res.status(400).send({ message: "El snippet necesita al menos un alimento" });
    }

    const snippet = await mealSnippetDao.create(req.auth.userId, name, customProducts, customRecipes);
    return res.status(201).send(snippet);
  },

  async listSnippets(req, res) {
    const snippets = await mealSnippetDao.listByTrainer(req.auth.userId);
    return res.send(snippets);
  },

  async renameSnippet(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const snippet = await mealSnippetDao.rename(req.auth.userId, req.params.id, name);
    if (!snippet) return res.status(404).send({ message: "Snippet no encontrado" });
    return res.send(snippet);
  },

  async deleteSnippet(req, res) {
    const result = await mealSnippetDao.delete(req.auth.userId, req.params.id);
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Snippet no encontrado" });
    }
    res.sendStatus(204);
  },
};
