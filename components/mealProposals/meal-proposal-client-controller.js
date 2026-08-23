const mealProposalDao = require("./meal-proposal-dao");
const mealModel = require("../meals/meal-service");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");

module.exports = {
  // GET /diets/:date/meal-proposals — cliente, TODAS las propuestas de ese
  // día (elegidas o no): el selector del cliente necesita ver también la
  // ya elegida para poder alternar, no solo las pendientes.
  async listForDate(req, res) {
    const proposals = await mealProposalDao.listForClientAndDate(req.auth.userId, req.params.date);
    return res.send(proposals);
  },

  // POST /diets/:date/meal-proposals/:proposalId/choose — cliente elige (o
  // cambia) una alternativa. Sin límite de una sola vez: pasteMeal ya
  // reemplaza el contenido de la comida en cada llamada (merge:false), así
  // que alternar entre opciones varias veces es seguro y no acumula nada.
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

    const dietDay = await resolveOwnedDietDay(req.auth.userId, proposal.date);
    const targetMeal = (dietDay.meals || []).find((meal) => meal.name === proposal.mealSlot);
    if (!targetMeal) {
      return res.status(400).send({ message: `No existe la comida "${proposal.mealSlot}" en tu dieta de hoy` });
    }

    const mealClipboard = {
      customProducts: alternative.customProducts || [],
      customRecipes: alternative.customRecipes || [],
    };
    const updatedMeal = await mealModel.pasteMeal(mealClipboard, targetMeal, false, proposal.trainerId);
    // TAREA 1 (coach-tab) — igual que prescribeMeal: el resultado de elegir
    // una alternativa propuesta por el profesional también queda protegido
    // de edición libre, mismo mecanismo de assignedByTrainerId.
    await mealModel.markAssignedByTrainer(targetMeal._id, proposal.trainerId);

    await mealProposalDao.setChosenIndex(proposal._id, chosenIndex);

    return res.send(updatedMeal);
  },
};
