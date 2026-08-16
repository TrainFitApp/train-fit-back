const planAssignmentSchema = require("./plan-assignment-schema");

module.exports = {
  async create(data) {
    return planAssignmentSchema.create(data);
  },

  async findById(id) {
    return planAssignmentSchema.findById(id);
  },

  async findActiveByClient(clientId) {
    return planAssignmentSchema
      .findOne({ clientId, status: "active" })
      .populate("planId")
      .lean();
  },

  // Populado en profundidad (a diferencia de findActiveByClient, que el
  // resolver usa internamente y solo necesita los ids) — esta versión la usa
  // la pantalla "Ver dieta" del trainer, que sí necesita el nombre de cada
  // Meal para mostrarlo.
  async findActiveByTrainerAndClient(trainerId, clientId) {
    return planAssignmentSchema
      .findOne({ trainerId, clientId, status: "active" })
      .populate({
        path: "planId",
        populate: { path: "days.meals", model: "Meal" },
      })
      .lean();
  },

  async markSuperseded(id, supersededById) {
    return planAssignmentSchema.findByIdAndUpdate(id, {
      $set: { status: "superseded", supersededBy: supersededById },
    });
  },

  async markEnded(id) {
    return planAssignmentSchema.findByIdAndUpdate(id, { $set: { status: "ended" } });
  },
};
