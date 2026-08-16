const mealProposalDao = require("./meal-proposal-dao");
const mealSlotWriter = require("./meal-slot-writer");
const mealSchema = require("../meals/meal-schema");
const mealSnippetDao = require("../mealSnippets/meal-snippet-dao");
const customProductDao = require("../customProducts/custom-product-dao");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  // "Pautar": fija directo una comida real del cliente y la bloquea
  // (Meal.assignedByTrainerId). Sin propuesta de por medio. Dos formas: a
  // partir de un snippet propio ya construido (clonado, mismo cloneMealDeep
  // de la funcionalidad 6), o desde cero con nombre + productos sueltos.
  async pinMeal(trainerId, clientId, { date, mealSlot, name, products, snippetId }) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");

    const dietDay = await mealSlotWriter.getOrCreateDietDay(clientId, date);
    const previousMealId = dietDay.meals?.[mealSlot]?._id || null;

    let mealId;
    if (snippetId) {
      const snippet = await mealSnippetDao.findById(snippetId);
      if (!snippet || String(snippet.trainerId) !== String(trainerId)) {
        throw makeError(404, "SNIPPET_NOT_FOUND", "Snippet no encontrado");
      }
      mealId = await dietTemplateDao.cloneMealDeep(snippet.meal);
      await mealSchema.findByIdAndUpdate(mealId, { $set: { assignedByTrainerId: trainerId } });
    } else {
      const meal = await mealSchema.create({
        name: name || "Comida pautada",
        assignedByTrainerId: trainerId,
        customProducts: [],
        customRecipes: [],
      });
      mealId = meal._id;

      for (const product of products || []) {
        await customProductDao.createCustomProductAndAddToMeal(mealId, product, trainerId);
      }
    }

    await mealSlotWriter.replaceMealSlot(dietDay._id, mealSlot, previousMealId, mealId);
    notificationService.notifyClient(clientId, trainerId, "meal_pinned", "Meal", mealId);
    return mealSchema.findById(mealId).populate({
      path: "customProducts",
      populate: { path: "product" },
    });
  },

  // "Proponer": 2+ alternativas (cada una un snippet propio del trainer,
  // clonado en profundidad — mismo cloneMealDeep de la funcionalidad 6) para
  // que el cliente elija.
  async createProposal(trainerId, clientId, { date, mealSlot, alternatives }) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");

    if (!Array.isArray(alternatives) || alternatives.length < 2) {
      throw makeError(400, "NEED_TWO_ALTERNATIVES", "Se necesitan al menos 2 alternativas");
    }

    const clonedAlternatives = [];
    for (const alt of alternatives) {
      const snippet = await mealSnippetDao.findById(alt.snippetId);
      if (!snippet || String(snippet.trainerId) !== String(trainerId)) {
        throw makeError(404, "SNIPPET_NOT_FOUND", "Snippet no encontrado");
      }
      const clonedMealId = await dietTemplateDao.cloneMealDeep(snippet.meal);
      clonedAlternatives.push({ label: alt.label || snippet.name, meal: clonedMealId });
    }

    const proposal = await mealProposalDao.create({
      trainerId,
      clientId,
      date,
      mealSlot,
      alternatives: clonedAlternatives,
      chosenIndex: null,
    });
    notificationService.notifyClient(clientId, trainerId, "meal_proposed", "MealProposal", proposal._id);
    return proposal;
  },

  async listPendingForMe(clientId) {
    return mealProposalDao.findPendingByClient(clientId);
  },

  async listForClient(trainerId, clientId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");
    return mealProposalDao.findByTrainerAndClient(trainerId, clientId);
  },

  async chooseAlternative(clientId, proposalId, chosenIndex) {
    const proposal = await mealProposalDao.findById(proposalId);
    if (!proposal || String(proposal.clientId) !== String(clientId)) {
      throw makeError(404, "PROPOSAL_NOT_FOUND", "Propuesta no encontrada");
    }
    if (proposal.chosenIndex !== null && proposal.chosenIndex !== undefined) {
      throw makeError(409, "ALREADY_CHOSEN", "Ya elegiste una alternativa para esta propuesta");
    }
    const chosen = proposal.alternatives[chosenIndex];
    if (!chosen) {
      throw makeError(400, "INVALID_INDEX", "Alternativa inválida");
    }

    const dietDay = await mealSlotWriter.getOrCreateDietDay(clientId, proposal.date);
    const previousMealId = dietDay.meals?.[proposal.mealSlot]?._id || null;
    await mealSlotWriter.replaceMealSlot(dietDay._id, proposal.mealSlot, previousMealId, chosen.meal);

    return mealProposalDao.markChosen(proposalId, chosenIndex);
  },
};
