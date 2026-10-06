const Schedule = require("./checkin-schedule-schema");

// Programaciones de check-in (checkin-schedule-schema.js), siempre por
// profesional y cliente.

const scope = (trainerId, clientId) => ({ trainerId, clientId });

module.exports = {
  // Programaciones que casan con `filter`, de la más antigua a la más nueva.
  listWhere(filter) {
    return Schedule.find(filter).sort({ createdAt: 1 }).lean();
  },

  // Todas las programaciones del profesional (alertas de la cartera).
  listForTrainer(trainerId) {
    return Schedule.find({ trainerId }).lean();
  },

  async list(trainerId, clientId) {
    return Schedule.find(scope(trainerId, clientId)).sort({ createdAt: 1 }).lean();
  },

  async findOwned(trainerId, clientId, id) {
    return Schedule.findOne({ ...scope(trainerId, clientId), _id: id }).lean();
  },

  async create(trainerId, clientId, data) {
    return Schedule.create({ ...scope(trainerId, clientId), ...data });
  },

  // Solo si nadie la ha cambiado desde `revision` (compare-and-swap). null si
  // no existe o cambió.
  async updateAtRevision(trainerId, clientId, id, revision, set) {
    return Schedule.findOneAndUpdate(
      { ...scope(trainerId, clientId), _id: id, revision },
      { $set: set, $inc: { revision: 1 } },
      { new: true }
    ).lean();
  },

  async setActive(trainerId, clientId, id, active) {
    return Schedule.findOneAndUpdate(
      { ...scope(trainerId, clientId), _id: id },
      { $set: { active }, $inc: { revision: 1 } },
      { new: true }
    ).lean();
  },

  // Aplicar una plantilla: crea o reemplaza la programación de esa plantilla.
  async upsertFromTemplate(trainerId, clientId, templateId, set) {
    return Schedule.findOneAndUpdate(
      { ...scope(trainerId, clientId), sourceTemplateId: templateId },
      { $set: set, $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  },

  // Una programación del cliente (para responderla).
  async findForClient(id, clientId) {
    return Schedule.findOne({ _id: id, clientId }).lean();
  },

  async remove(trainerId, clientId, id) {
    return Schedule.findOneAndDelete({ ...scope(trainerId, clientId), _id: id }).lean();
  },
};
