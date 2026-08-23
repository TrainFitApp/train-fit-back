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

  // Dashboard trainer, "Requiere tu atención" — asignaciones activas de
  // CUALQUIER cliente de este trainer cuyo endDate cae dentro del rango
  // dado (p.ej. próximos 7 días) — a diferencia de findActiveForClient, que
  // es de un cliente concreto. endDate:null (indefinido) queda fuera a
  // propósito: nada que "caduque pronto" ahí.
  async listEndingSoonForTrainer(trainerId, fromDateStr, toDateStr) {
    return PlanAssignment.find({
      trainerId,
      status: "active",
      endDate: { $ne: null, $gte: fromDateStr, $lte: toDateStr },
    })
      .populate("clientId", "name lastname")
      .lean();
  },

  async markSuperseded(id, supersededBy) {
    return PlanAssignment.findByIdAndUpdate(
      id,
      { $set: { status: "superseded", supersededBy } },
      { new: true }
    );
  },
};
