const RoutineAssignment = require("./routine-assignment-schema");

module.exports = {
  async create({ tableId, clientId, trainerId, startDate }) {
    return RoutineAssignment.create({ tableId, clientId, trainerId, startDate });
  },

  // La asignación vigente para una fecha concreta — cubre "qué toca hoy" y
  // "qué regía tal día del pasado" con la misma consulta: status no se
  // filtra, porque una asignación "superseded" sigue siendo la respuesta
  // correcta para fechas anteriores a cuando fue sustituida.
  //
  // Desempate por createdAt (borrado coherente de fases/rutinas) — dos
  // fases con el MISMO startDate (aplicar A y luego B el mismo día, el
  // escenario que motivó ese rediseño) hacían esta consulta no determinista
  // sin él.
  async findCoveringDate(clientId, date) {
    return RoutineAssignment.findOne({
      clientId,
      startDate: { $lte: date },
    }).sort({ startDate: -1, createdAt: -1 });
  },

  // Asignaciones que colisionan con una nueva que empieza en `startDate`.
  // Sin endDate, "solapar" se reduce a una dimensión: cualquier asignación
  // (no terminada) con startDate >= la nueva es candidata a bloquear — el
  // service decide cuáles de verdad bloquean (ver blocksNewPhase).
  async findOverlapping(clientId, startDate, { excludeId } = {}) {
    const query = {
      clientId,
      status: { $ne: "ended" },
      startDate: { $gte: startDate },
    };
    if (excludeId) query._id = { $ne: excludeId };
    return RoutineAssignment.find(query).sort({ startDate: 1 });
  },

  // La asignación "activa" tal cual la entiende el entrenador ahora mismo —
  // a lo sumo una por cliente, mantenida por markSuperseded.
  async findActiveForClient(clientId) {
    return RoutineAssignment.findOne({ clientId, status: "active" });
  },

  // Mismo desempate por createdAt que findCoveringDate — el borrado
  // coherente de fases usa el primer elemento de esta lista como "nuevo
  // tip" tras quitar el que lo era.
  async listByClient(clientId) {
    return RoutineAssignment.find({ clientId }).sort({ startDate: -1, createdAt: -1 });
  },

  // Tarea 5 (2026-09) — historial de fases de VARIOS clientes de una vez,
  // para la adherencia de entrenamiento de Cartera (un cliente a la vez
  // sería un N+1 sobre todo el roster de un entrenador). Ascendente (al
  // revés que listByClient) con desempate por createdAt — dos fases con la
  // misma startDate no están prohibidas por blocksNewPhase, y sin desempate
  // el recorrido de tramos no sería determinista.
  async listByClients(clientIds) {
    if (!clientIds?.length) return new Map();
    const assignments = await RoutineAssignment.find({ clientId: { $in: clientIds } }).sort({
      startDate: 1,
      createdAt: 1,
    });
    const byClient = new Map();
    for (const assignment of assignments) {
      const key = String(assignment.clientId);
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(assignment);
    }
    return byClient;
  },

  async markSuperseded(id, supersededBy) {
    return RoutineAssignment.findByIdAndUpdate(
      id,
      { $set: { status: "superseded", supersededBy } },
      { new: true }
    );
  },

  async findByIdAndClient(id, clientId) {
    return RoutineAssignment.findOne({ _id: id, clientId });
  },

  // Borrado coherente de fases/rutinas — todas las fases (0, 1 o varias;
  // una tabla se puede reasignar más de una vez) que referencian una tabla
  // concreta para un cliente. La usa deleteTable para limpiarlas antes de
  // borrar la Table de verdad.
  async findByTableAndClient(tableId, clientId) {
    return RoutineAssignment.find({ tableId, clientId });
  },

  // Tarea 4bis (2026-09) — la fase que esta ID sustituyó, si la hay. Al
  // cancelar una fase programada hay que reactivar la que estaba en curso
  // antes de programarla, o el cliente se queda sin ninguna fase "active".
  async findSupersededBy(id) {
    return RoutineAssignment.findOne({ supersededBy: id });
  },

  async reactivate(id) {
    return RoutineAssignment.findByIdAndUpdate(
      id,
      { $set: { status: "active" }, $unset: { supersededBy: "" } },
      { new: true }
    );
  },

  async deleteById(id) {
    return RoutineAssignment.findByIdAndDelete(id);
  },

  async updateStartDate(id, startDate) {
    return RoutineAssignment.findByIdAndUpdate(id, { $set: { startDate } }, { new: true });
  },
};
