const CheckinTemplateDefinition = require("./checkin-template-definition-schema");
const TrainerCheckinTemplate = require("./trainer-checkin-template-schema");
const CheckinResponse = require("./checkin-response-schema");

module.exports = {
  // --- CheckinTemplateDefinition (plantillas maestras) ---
  async createDefinition(trainerId, name, enabledFields, cadence) {
    return CheckinTemplateDefinition.create({ trainerId, name, enabledFields, cadence });
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
  // Copia enabledFields/cadence de la definición al momento de aplicar —
  // nunca una referencia viva.
  async applyToClient(trainerId, clientId, definition) {
    return TrainerCheckinTemplate.findOneAndUpdate(
      { trainerId, clientId },
      {
        $set: {
          enabledFields: definition.enabledFields,
          cadence: definition.cadence,
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

  async listResponses(trainerId, clientId) {
    return CheckinResponse.find({ trainerId, clientId }).sort({ respondedAt: -1 }).lean();
  },

  // "Reportes": trainerId por sí solo escopea a TODOS los clientes.
  async listResponsesForTrainer(trainerId, { limit = 200 } = {}) {
    return CheckinResponse.find({ trainerId })
      .sort({ respondedAt: -1 })
      .limit(limit)
      .populate("clientId", "name lastname email")
      .lean();
  },

  async countUnseenForTrainer(trainerId) {
    return CheckinResponse.countDocuments({ trainerId, seenByTrainer: false });
  },

  async markAllSeenForTrainer(trainerId) {
    return CheckinResponse.updateMany(
      { trainerId, seenByTrainer: false },
      { $set: { seenByTrainer: true } }
    );
  },
};
