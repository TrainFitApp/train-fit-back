const mongoose = require("mongoose");
const CheckinTemplateDefinition = require("./checkin-template-definition-schema");
const CheckinResponse = require("./checkin-response-schema");
const CheckinRequest = require("./checkin-request-schema");

module.exports = {
  // --- CheckinTemplateDefinition (plantillas maestras) ---
  async createDefinition(trainerId, name, enabledFields, timing = {}, customQuestions = []) {
    return CheckinTemplateDefinition.create({
      trainerId,
      name,
      enabledFields,
      frequency: timing.frequency || "weekly",
      interval: timing.interval || 1,
      customQuestions,
    });
  },

  async listDefinitions(trainerId) {
    return CheckinTemplateDefinition.find({ trainerId }).sort({ name: 1 }).lean();
  },

  async getDefinitionById(trainerId, id) {
    return CheckinTemplateDefinition.findOne({ _id: id, trainerId });
  },

  async updateDefinition(trainerId, id, updates) {
    return CheckinTemplateDefinition.findOneAndUpdate(
      { _id: id, trainerId },
      { $set: updates },
      { new: true, runValidators: true }
    );
  },

  async deleteDefinition(trainerId, id) {
    return CheckinTemplateDefinition.findOneAndDelete({ _id: id, trainerId });
  },

  // --- CheckinResponse (histórico, solo campos wellbeing-backed) ---
  async createResponse(trainerId, clientId, values) {
    return CheckinResponse.create({ trainerId, clientId, values });
  },

  // Reescribe los valores de una respuesta ya enviada. `respondedAt` NO se
  // toca: mueve la respuesta de ciclo y falsearía la adherencia.
  async updateResponseValues(responseId, values) {
    return CheckinResponse.findByIdAndUpdate(
      responseId,
      { $set: { values, seenByTrainer: false } },
      { new: true }
    );
  },

  async listResponses(trainerId, clientId) {
    const [legacy, scheduled] = await Promise.all([
      CheckinResponse.find({ trainerId, clientId }).sort({ respondedAt: -1 }).lean(),
      require("./checkin-request-schema").find({ trainerId, clientId, status: { $in: ["responded", "reviewed"] } }).sort({ respondedAt: -1 }).lean(),
    ]);
    return [...new Map([...legacy, ...scheduled].map(r => [String(r._id), r])).values()].sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));
  },

  // TASK-002 (MASTER_BACKLOG.md) — "Reportes": a diferencia de listResponses,
  // trainerId por sí solo ya escopea a TODOS los clientes de este
  // entrenador (no hace falta iterar cliente a cliente, a diferencia de
  // listMyHistory en checkin-controller.js que itera por trainerId variable
  // desde el lado del cliente). populate('clientId') trae nombre/apellido
  // reales sin una query aparte. Limit acotado (mismo espíritu que TASK-015:
  // nunca traer histórico completo sin límite).
  async listResponsesForTrainer(trainerId, { limit = 200 } = {}) {
    return CheckinResponse.find({ trainerId })
      .sort({ respondedAt: -1 })
      .limit(limit)
      .populate("clientId", "name lastname email")
      .lean();
  },

  // Última respuesta (fecha) de CADA cliente de este trainer, en una sola
  // agregación — a diferencia de listResponsesForTrainer (limit() global
  // ordenado por fecha, que con muchos clientes activos podría dejar fuera
  // la respuesta más reciente de un cliente poco activo y hacerlo parecer
  // "sin responder nunca" por error).
  async getLatestResponseByClient(trainerId) {
    return CheckinResponse.aggregate([
      { $match: { trainerId: new mongoose.Types.ObjectId(trainerId) } },
      { $sort: { respondedAt: -1 } },
      { $group: { _id: "$clientId", respondedAt: { $first: "$respondedAt" } } },
    ]);
  },

  // Fase 3 Coach Pro — respuestas de TODOS los clientes de un profesional
  // desde una fecha, con sus valores. Una sola consulta para toda la
  // cartera, a diferencia de listResponses (un cliente) y de
  // getLatestResponseByClient (solo la fecha de la última).
  //
  // El motor de reglas necesita los VALORES (estrés, sueño, pasos…), no solo
  // saber cuándo respondió: sin esto, una regla sobre bienestar exigiría una
  // consulta por cliente cada noche.
  async listResponsesForTrainerSince(trainerId, since) {
    return CheckinResponse.find({ trainerId, respondedAt: { $gte: since } })
      .select("clientId respondedAt values")
      .sort({ respondedAt: 1 })
      .lean();
  },

  // --- Ocurrencias (CheckinRequest) ---
  // La adherencia, la Cartera y las alertas miden sobre solicitudes reales,
  // no sobre una cadencia declarada (ver checkin-occurrences.js). Estas dos
  // consultas son su única fuente.
  async listRequestsInWindow(trainerId, clientId, from, to) {
    return CheckinRequest.find({
      trainerId,
      clientId,
      scheduledAt: {
        $gte: new Date(`${from}T00:00:00.000Z`),
        $lte: new Date(`${to}T23:59:59.999Z`),
      },
    })
      .select("scheduledAt closesAt status respondedAt name")
      .sort({ scheduledAt: -1 })
      .lean();
  },

  // Toda la cartera de una vez: el evaluador nocturno y la Cartera miran a
  // 30 clientes a la vez y no pueden permitirse una consulta por cliente.
  async listRequestsForTrainerSince(trainerId, since) {
    return CheckinRequest.find({ trainerId, scheduledAt: { $gte: since } })
      .select("clientId scheduledAt closesAt status respondedAt name")
      .sort({ scheduledAt: -1 })
      .lean();
  },

  async countUnseenForTrainer(trainerId) {
    return CheckinResponse.countDocuments({ trainerId, seenByTrainer: false });
  },

  async markAllSeenForTrainer(trainerId) {
    return CheckinResponse.updateMany({ trainerId, seenByTrainer: false }, { $set: { seenByTrainer: true } });
  },
};
