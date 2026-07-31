const TrainerClient = require("./trainer-client-schema");

module.exports = {
  async create({ trainerId, clientEmail, scope }) {
    return TrainerClient.create({ trainerId, clientEmail, scope });
  },

  async findById(id) {
    return TrainerClient.findById(id);
  },

  // scope opcional: si se omite, cualquier scope activo del cliente con ese
  // trainerId satisface la comprobación (usado por notas internas, check-in, etc.).
  async findActiveByTrainerAndClient(trainerId, clientId, scope) {
    const query = { trainerId, clientId, status: "active" };
    if (scope) query.scope = scope;
    return TrainerClient.findOne(query);
  },

  // ¿Existe alguna relación activa del cliente para este scope, con CUALQUIER
  // profesional? Usado por F14 para decidir si aplican las exenciones de límite.
  async hasActiveRelation(clientId, scope) {
    const query = { clientId, status: "active" };
    if (scope) query.scope = scope;
    const relation = await TrainerClient.findOne(query).select("_id").lean();
    return Boolean(relation);
  },

  async findPendingByEmail(clientEmail) {
    return TrainerClient.find({
      clientEmail: clientEmail.trim().toLowerCase(),
      status: "pending",
    }).sort({ invitedAt: -1 });
  },

  async findActiveByClient(clientId) {
    return TrainerClient.find({ clientId, status: "active" }).sort({ respondedAt: -1 });
  },

  async findActiveByClientAndScope(clientId, scope) {
    return TrainerClient.findOne({ clientId, scope, status: "active" });
  },

  // Todas las relaciones (cualquier estado) de un profesional, agregables por cliente.
  async findAllByTrainer(trainerId, { status } = {}) {
    const query = { trainerId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.find(query).sort({ invitedAt: -1 });
  },

  async findAllByClient(clientId, { status } = {}) {
    const query = { clientId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.find(query).sort({ invitedAt: -1 });
  },

  // ¿Existe ya una relación ACTIVA de este scope, para este email/clientId, con
  // OTRO profesional distinto de excludingTrainerId? (regla de solapamiento, D1).
  async findOverlapping({ clientEmail, clientId, scope, excludingTrainerId }) {
    const query = {
      scope,
      status: "active",
      trainerId: { $ne: excludingTrainerId },
      $or: [{ clientEmail: clientEmail.trim().toLowerCase() }, ...(clientId ? [{ clientId }] : [])],
    };
    return TrainerClient.findOne(query);
  },

  async updateStatus(id, status, extra = {}) {
    return TrainerClient.findByIdAndUpdate(id, { $set: { status, ...extra } }, { new: true });
  },

  async countByTrainer(trainerId, { status } = {}) {
    const query = { trainerId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.countDocuments(query);
  },
};
