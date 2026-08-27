const mongoose = require("mongoose");
const CheckinTemplateDefinition = require("./checkin-template-definition-schema");
const TrainerCheckinTemplate = require("./trainer-checkin-template-schema");
const CheckinResponse = require("./checkin-response-schema");

module.exports = {
  // --- CheckinTemplateDefinition (plantillas maestras) ---
  async createDefinition(trainerId, name, enabledFields, cadence, customQuestions = []) {
    return CheckinTemplateDefinition.create({
      trainerId,
      name,
      enabledFields,
      cadence,
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

  // --- TrainerCheckinTemplate (configuración ya aplicada a un cliente) ---
  // Copia enabledFields/cadence de la definición al momento de aplicar — nunca
  // una referencia viva (ver modelos-de-datos/03-trainercheckintemplate.md).
  async applyToClient(trainerId, clientId, definition) {
    return TrainerCheckinTemplate.findOneAndUpdate(
      { trainerId, clientId },
      {
        $set: {
          enabledFields: definition.enabledFields,
          cadence: definition.cadence,
          // Fase 5 — las preguntas propias se copian igual que el resto,
          // CONSERVANDO su _id: la respuesta viaja con la clave
          // "custom:<id>" (ver checkin-custom-question.js), así que
          // regenerar los ids al reaplicar dejaría huérfanas todas las
          // respuestas anteriores, que aparecerían sin enunciado.
          customQuestions: (definition.customQuestions || []).map((q) =>
            typeof q.toObject === "function" ? q.toObject() : q
          ),
          sourceTemplateId: definition._id,
          updatedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    );
  },

  async getAppliedConfig(trainerId, clientId) {
    return TrainerCheckinTemplate.findOne({ trainerId, clientId }).lean();
  },

  async getAppliedConfigsForClient(clientId) {
    return TrainerCheckinTemplate.find({ clientId }).lean();
  },

  // --- CheckinResponse (histórico, solo campos wellbeing-backed) ---
  async createResponse(trainerId, clientId, values) {
    return CheckinResponse.create({ trainerId, clientId, values });
  },

  // La respuesta de ESTE ciclo, si ya existe. Un ciclo es la ventana de
  // `cadenceDays` días que acaba ahora: con cadencia semanal, los últimos 7.
  async findResponseInCurrentCycle(trainerId, clientId, cadenceDays, now = new Date()) {
    const desde = new Date(now.getTime() - cadenceDays * 86400000);
    return CheckinResponse.findOne({
      trainerId,
      clientId,
      respondedAt: { $gte: desde, $lte: now },
    }).sort({ respondedAt: -1 });
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
    return CheckinResponse.find({ trainerId, clientId }).sort({ respondedAt: -1 }).lean();
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

  // Dashboard trainer, "Requiere tu atención" — configuraciones de check-in
  // aplicadas por este trainer a CUALQUIERA de sus clientes (a diferencia de
  // getAppliedConfigsForClient, que es de un cliente concreto). Junto con
  // getLatestResponseByClient sirve para calcular isCheckinDue por cliente
  // sin recorrer clientes uno a uno.
  async getAppliedConfigsForTrainer(trainerId) {
    return TrainerCheckinTemplate.find({ trainerId }).populate("clientId", "name lastname").lean();
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

  // TASK-024 (MASTER_BACKLOG.md)
  async countUnseenForTrainer(trainerId) {
    return CheckinResponse.countDocuments({ trainerId, seenByTrainer: false });
  },

  async markAllSeenForTrainer(trainerId) {
    return CheckinResponse.updateMany({ trainerId, seenByTrainer: false }, { $set: { seenByTrainer: true } });
  },
};
