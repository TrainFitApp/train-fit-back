const MealProposal = require("./meal-proposal-schema");

module.exports = {
  async create(trainerId, clientId, date, mealSlot, alternatives) {
    return MealProposal.create({ trainerId, clientId, date, mealSlot, alternatives });
  },

  // Propuestas de un cliente para una fecha, de CUALQUIER profesional con
  // relación activa (ya filtrado en el controller) — aún no elegidas.
  async listPendingForClientAndDate(clientId, date) {
    return MealProposal.find({ clientId, date, chosenIndex: null }).lean();
  },

  // Igual que arriba pero sin filtrar por fecha — usado por el dashboard del
  // Coach (F1 del tab Coach) para mostrar TODAS las propuestas pendientes de
  // elegir, no solo las de un día concreto.
  async listAllPendingForClient(clientId) {
    return MealProposal.find({ clientId, chosenIndex: null }).lean();
  },

  async findById(id) {
    return MealProposal.findById(id);
  },

  async setChosenIndex(id, chosenIndex) {
    return MealProposal.findByIdAndUpdate(id, { $set: { chosenIndex } }, { new: true });
  },
};
