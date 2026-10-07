const mongoose = require("mongoose");
const CheckinTemplateDefinition = require("./checkin-template-definition-schema");
const CheckinResponse = require("./checkin-response-schema");

module.exports = {
  // Respuestas que casan con `filter` (agenda de check-ins).
  listResponsesWhere(filter, fields = null) {
    const query = CheckinResponse.find(filter);
    if (fields) query.select(fields);
    return query.lean();
  },

  // La respuesta de una ocurrencia (programación + fecha), si la hay.
  findOccurrenceResponse(scheduleId, occurrenceDate, fields = null) {
    const query = CheckinResponse.findOne({ scheduleId, occurrenceDate });
    if (fields) query.select(fields);
    return query.lean();
  },

  // Responder (o reescribir) una ocurrencia: una respuesta por ocurrencia.
  upsertOccurrenceResponse(scheduleId, occurrenceDate, update) {
    return CheckinResponse.findOneAndUpdate({ scheduleId, occurrenceDate }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean();
  },

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

  async review(trainerId, clientId, id, comment) {
    return CheckinResponse.findOneAndUpdate(
      { _id: id, trainerId, clientId },
      { $set: { status: "reviewed", reviewedAt: new Date(), reviewComment: comment } },
      { new: true }
    ).lean();
  },

  // Las respuestas de la semana N de una fase, vengan del profesional que
  // vengan (la necesidad por semana no sabe de trainerId). Son varias cuando
  // la programación es más frecuente que semanal; van de la más reciente a
  // la más antigua.
  async listWeekResponses(clientId, phaseId, number) {
    return CheckinResponse.find({ clientId, "week.phaseId": phaseId, "week.number": number })
      .sort({ respondedAt: -1 })
      .select("values respondedAt updatedAt week")
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

  // --- Bandeja «Por revisar» y Cartera ---
  // Respuestas que esperan el comentario del profesional. Sin status cuenta
  // como respondida, igual que en la agenda (checkin-agenda-service.js).

  async listPendingReviewForTrainer(trainerId, clientIds) {
    return CheckinResponse.find({ trainerId, clientId: { $in: clientIds }, status: { $ne: "reviewed" } })
      .select("clientId name occurrenceDate respondedAt week")
      .sort({ respondedAt: 1 })
      .populate("clientId", "name lastname email")
      .lean();
  },

  async countPendingReviewForTrainer(trainerId, clientIds) {
    return CheckinResponse.countDocuments({ trainerId, clientId: { $in: clientIds }, status: { $ne: "reviewed" } });
  },

  async countPendingReviewByClient(trainerId, clientIds) {
    const rows = await CheckinResponse.aggregate([
      {
        $match: {
          trainerId: new mongoose.Types.ObjectId(String(trainerId)),
          clientId: { $in: clientIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          status: { $ne: "reviewed" },
        },
      },
      { $group: { _id: "$clientId", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
  },
};
