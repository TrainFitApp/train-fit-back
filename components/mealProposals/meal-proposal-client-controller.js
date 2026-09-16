const mealProposalDao = require("./meal-proposal-dao");

module.exports = {
  // GET /diets/:date/meal-proposals — cliente, TODAS las propuestas de ese
  // día (elegidas o no): el selector del cliente necesita ver también la
  // ya elegida para poder alternar, no solo las pendientes.
  async listForDate(req, res) {
    const proposals = await mealProposalDao.listForClientAndDate(req.auth.userId, req.params.date);
    return res.send(proposals);
  },

  // POST /diets/:date/meal-proposals/:proposalId/choose — cliente elige (o
  // cambia) una alternativa. Sin límite de una sola vez: cada llamada quita
  // lo pautado anterior y aplica la opción nueva, así que alternar entre
  // opciones varias veces es seguro y no acumula nada.
  async choose(req, res) {
    const proposal = await mealProposalDao.findById(req.params.proposalId);
    if (!proposal || String(proposal.clientId) !== String(req.auth.userId)) {
      return res.status(404).send({ message: "Propuesta no encontrada" });
    }
    if (proposal.date !== req.params.date) {
      return res.status(400).send({ message: "La propuesta no corresponde a esta fecha" });
    }

    const chosenIndex = Number(req.body?.chosenIndex);
    const alternative = proposal.alternatives[chosenIndex];
    if (!alternative) {
      return res.status(400).send({ message: "chosenIndex no corresponde a ninguna alternativa" });
    }

    // Solo se sustituye lo pautado; lo que el cliente añadió por su cuenta a
    // esta comida se queda (ver meal-proposal-dao.js#applyAlternative).
    const updatedMeal = await mealProposalDao.choose(proposal._id, chosenIndex);
    if (!updatedMeal) {
      return res.status(404).send({ message: "Propuesta no encontrada" });
    }

    return res.send(updatedMeal);
  },
};
