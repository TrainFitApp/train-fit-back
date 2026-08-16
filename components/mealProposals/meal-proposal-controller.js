const mealProposalService = require("./meal-proposal-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({ message: error.message, code: error.code });
  }
  console.error("[MEAL_PROPOSALS] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async pinMeal(req, res) {
    try {
      const meal = await mealProposalService.pinMeal(req.user.id, req.params.clientId, req.body || {});
      return res.status(201).send(meal);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async createProposal(req, res) {
    try {
      const proposal = await mealProposalService.createProposal(
        req.user.id,
        req.params.clientId,
        req.body || {}
      );
      return res.status(201).send(proposal);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async listForClient(req, res) {
    try {
      const proposals = await mealProposalService.listForClient(req.user.id, req.params.clientId);
      return res.send(proposals);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Lado cliente ---

  async listMine(req, res) {
    const proposals = await mealProposalService.listPendingForMe(req.user.id);
    return res.send(proposals);
  },

  async chooseAlternative(req, res) {
    try {
      const proposal = await mealProposalService.chooseAlternative(
        req.user.id,
        req.params.id,
        Number(req.body?.chosenIndex)
      );
      return res.send(proposal);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
