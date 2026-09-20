const mongoose = require("mongoose");
const CheckinTemplateDefinition = require("./checkin-template-definition-schema");
const CheckinResponse = require("./checkin-response-schema");

module.exports = {
  // --- CheckinTemplateDefinition (plantillas maestras del profesional) ---
  async createDefinition(trainerId, name, enabledFields, customQuestions = [], requiredFields = []) {
    return CheckinTemplateDefinition.create({
      trainerId,
      name,
      enabledFields,
      requiredFields,
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

  // --- CheckinResponse ---
  async listResponses(trainerId, clientId) {
    return CheckinResponse.find({ trainerId, clientId }).sort({ respondedAt: -1 }).lean();
  },

  async listResponsesForClient(clientId, { limit = 200 } = {}) {
    return CheckinResponse.find({ clientId }).sort({ respondedAt: -1 }).limit(limit).lean();
  },

  async findById(id) {
    return CheckinResponse.findById(id).lean();
  },

  async findByIdForTrainer(trainerId, clientId, id) {
    return CheckinResponse.findOne({ _id: id, trainerId, clientId }).lean();
  },

  async review(trainerId, clientId, id, comment) {
    return CheckinResponse.findOneAndUpdate(
      { _id: id, trainerId, clientId },
      { $set: { status: "reviewed", reviewedAt: new Date(), reviewComment: comment, seenByTrainer: true } },
      { new: true }
    ).lean();
  },

  // Todas las respuestas ligadas a una revisión de dieta — historial de
  // nutrición del trainer.
  async listRevisionResponses(clientId) {
    return CheckinResponse.find({ clientId, "revision.phaseId": { $ne: null } })
      .select("respondedAt updatedAt values revision name")
      .lean();
  },

  // La respuesta de la revisión N de una fase, venga del profesional que
  // venga (la necesidad por revisión no sabe de trainerId).
  async findRevisionResponse(clientId, phaseId, number) {
    return CheckinResponse.findOne({ clientId, "revision.phaseId": phaseId, "revision.number": number })
      .sort({ respondedAt: -1 })
      .select("values respondedAt updatedAt revision")
      .lean();
  },

  // Qué solicitudes tiene YA respondidas cada cliente de este profesional
  // (clave "scheduleId:fecha"), para saber cuáles se cerraron vacías sin
  // recorrer cliente a cliente.
  async listAnsweredOccurrences(trainerId, sinceDate) {
    return CheckinResponse.find({ trainerId, occurrenceDate: { $gte: sinceDate } })
      .select("clientId scheduleId occurrenceDate")
      .lean();
  },

  async listResponsesForTrainer(trainerId, { limit = 200 } = {}) {
    return CheckinResponse.find({ trainerId })
      .sort({ respondedAt: -1 })
      .limit(limit)
      .populate("clientId", "name lastname email")
      .lean();
  },

  // Última respuesta (fecha) de CADA cliente de este trainer, en una sola
  // agregación: con muchos clientes, un limit() global ordenado por fecha
  // dejaría fuera la última respuesta de un cliente poco activo y lo haría
  // parecer "sin responder nunca".
  async getLatestResponseByClient(trainerId) {
    return CheckinResponse.aggregate([
      { $match: { trainerId: new mongoose.Types.ObjectId(trainerId) } },
      { $sort: { respondedAt: -1 } },
      { $group: { _id: "$clientId", respondedAt: { $first: "$respondedAt" } } },
    ]);
  },

  // Respuestas de TODOS los clientes de un profesional desde una fecha, con
  // sus valores: el motor de reglas necesita los valores (estrés, sueño,
  // pasos…), no solo cuándo respondieron.
  async listResponsesForTrainerSince(trainerId, since) {
    return CheckinResponse.find({ trainerId, respondedAt: { $gte: since } })
      .select("clientId respondedAt values")
      .sort({ respondedAt: 1 })
      .lean();
  },

  async countUnseenForTrainer(trainerId) {
    return CheckinResponse.countDocuments({ trainerId, seenByTrainer: false });
  },

  async markAllSeenForTrainer(trainerId) {
    return CheckinResponse.updateMany({ trainerId, seenByTrainer: false }, { $set: { seenByTrainer: true } });
  },
};
