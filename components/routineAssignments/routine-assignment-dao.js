const RoutineAssignment = require("./routine-assignment-schema");
const { CHAIN_SORT_DESC } = require("../util/phase-chain");

// Fases de rutina (routine-assignment-schema.js), siempre en el orden de la
// cadena (util/phase-chain.js).

module.exports = {
  async create({ tableId, clientId, trainerId, startDate }) {
    return RoutineAssignment.create({ tableId, clientId, trainerId, startDate });
  },

  // La que rige en una fecha: la última que ha empezado ese día o antes. Vale
  // para hoy y para cualquier día del pasado.
  async findCoveringDate(clientId, date) {
    return RoutineAssignment.findOne({ clientId, startDate: { $lte: date } }).sort(CHAIN_SORT_DESC);
  },

  // La última de la cadena (puede estar programada para más adelante).
  async findLatest(clientId) {
    return RoutineAssignment.findOne({ clientId }).sort(CHAIN_SORT_DESC);
  },

  // Fases que empiezan DESPUÉS de `startDate`: una nueva en esa fecha las
  // dejaría huérfanas en medio de la cadena.
  async findStartingAfter(clientId, startDate, { excludeId } = {}) {
    const query = { clientId, startDate: { $gt: startDate } };
    if (excludeId) query._id = { $ne: excludeId };
    return RoutineAssignment.find(query).sort({ startDate: 1, createdAt: 1 });
  },

  // De la más reciente a la más antigua.
  async listByClient(clientId) {
    return RoutineAssignment.find({ clientId }).sort(CHAIN_SORT_DESC);
  },

  // Las fases de VARIOS clientes en una consulta (Cartera, alertas), por
  // cliente y en orden ascendente.
  async listByClients(clientIds) {
    if (!clientIds?.length) return new Map();
    const assignments = await RoutineAssignment.find({ clientId: { $in: clientIds } })
      .sort({ startDate: 1, createdAt: 1 })
      .lean();
    const byClient = new Map();
    for (const assignment of assignments) {
      const key = String(assignment.clientId);
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(assignment);
    }
    return byClient;
  },

  async findByIdAndClient(id, clientId) {
    return RoutineAssignment.findOne({ _id: id, clientId });
  },

  // Al borrar una rutina, sus fases (una rutina se puede asignar más de una vez).
  async deleteByTableAndClient(tableId, clientId) {
    return RoutineAssignment.deleteMany({ tableId, clientId });
  },

  async deleteById(id) {
    return RoutineAssignment.findByIdAndDelete(id);
  },

  async updateStartDate(id, startDate) {
    return RoutineAssignment.findByIdAndUpdate(id, { $set: { startDate } }, { new: true });
  },
};
