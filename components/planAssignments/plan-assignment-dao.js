const PlanAssignment = require("./plan-assignment-schema");

module.exports = {
  async create({ planId, clientId, trainerId, startDate, endMode, endDate }) {
    return PlanAssignment.create({ planId, clientId, trainerId, startDate, endMode, endDate });
  },

  // La asignación vigente para una fecha concreta — cubre el caso general
  // (resolver "qué toca hoy") y el caso "qué regía tal día del pasado" con la
  // misma consulta, ya que status no se filtra aquí por diseño: una
  // asignación "superseded" sigue siendo la respuesta correcta para fechas
  // anteriores a cuando fue sustituida.
  async findCoveringDate(clientId, date) {
    return PlanAssignment.findOne({
      clientId,
      startDate: { $lte: date },
      $or: [{ endDate: null }, { endDate: { $gte: date } }],
    }).sort({ startDate: -1 });
  },

  // La asignación "activa" tal cual la entiende el entrenador ahora mismo —
  // a lo sumo una por cliente, mantenida por supersede().
  async findActiveForClient(clientId) {
    return PlanAssignment.findOne({ clientId, status: "active" });
  },

  async findOwnedByTrainer(trainerId, id) {
    return PlanAssignment.findOne({ _id: id, trainerId });
  },

  async listByClient(clientId) {
    return PlanAssignment.find({ clientId }).sort({ startDate: -1 });
  },

  async markSuperseded(id, supersededBy) {
    return PlanAssignment.findByIdAndUpdate(
      id,
      { $set: { status: "superseded", supersededBy } },
      { new: true }
    );
  },
};
