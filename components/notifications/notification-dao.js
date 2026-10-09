const Notification = require("./notification-schema");

module.exports = {
  async create(clientId, trainerId, type, payload = {}) {
    return Notification.create({ clientId, trainerId, recipient: "client", type, payload });
  },

  async listForClient(clientId, { unreadOnly } = {}) {
    const filter = { clientId, recipient: "client" };
    if (unreadOnly) filter.read = false;
    return Notification.find(filter).sort({ createdAt: -1 }).lean();
  },

  async countUnread(clientId) {
    return Notification.countDocuments({ clientId, recipient: "client", read: false });
  },

  async markRead(clientId, notificationId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, clientId, recipient: "client" },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    ).lean();
  },

  async markAllRead(clientId) {
    return Notification.updateMany(
      { clientId, recipient: "client", read: false },
      { $set: { read: true, readAt: new Date() } }
    );
  },

  async deleteForClient(clientId, notificationId) {
    return Notification.findOneAndDelete({ _id: notificationId, clientId, recipient: "client" }).lean();
  },

  // --- Dashboard trainer (2026-08-18) — mismo patrón, sentido inverso ---
  async createForTrainer(trainerId, clientId, type, payload = {}) {
    return Notification.create({ clientId, trainerId, recipient: "trainer", type, payload });
  },

  async listForTrainer(trainerId, { unreadOnly } = {}) {
    const filter = { trainerId, recipient: "trainer" };
    if (unreadOnly) filter.read = false;
    return Notification.find(filter).sort({ createdAt: -1 }).lean();
  },

  async countUnreadForTrainer(trainerId) {
    return Notification.countDocuments({ trainerId, recipient: "trainer", read: false });
  },

  async markReadForTrainer(trainerId, notificationId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, trainerId, recipient: "trainer" },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    ).lean();
  },

  // --- Cobros 2026-09 ---
  // Alta idempotente: dedupeKey es único, así que dos procesos (o un
  // reintento) nunca crean el mismo aviso dos veces. null = ya existía.
  async createIdempotent({ clientId, trainerId, recipient, type, payload, dedupeKey, createdAt }) {
    try {
      return await Notification.create({ clientId, trainerId, recipient, type, payload, dedupeKey, createdAt });
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
  },

  async deleteById(notificationId) {
    return Notification.deleteOne({ _id: notificationId });
  },

  // Los avisos que apuntan a algo que ya no existe (una revisión de técnica
  // que el cliente borró): abrirlos daba 404.
  async deleteByPayload(type, field, value) {
    return Notification.deleteMany({ type, [`payload.${field}`]: String(value) });
  },

  // Un cobro liquidado/cancelado/anulado deja de ser deuda: sus avisos pasan a
  // históricos (resolution) y dejan de contar como no leídos. `beforeDueRevision`
  // limita la resolución a los avisos de un vencimiento ya cambiado.
  async resolvePaymentNotifications(trainerId, chargeId, resolution, { beforeDueRevision = null, now = new Date() } = {}) {
    const filter = {
      trainerId,
      type: { $in: ["payment_reminder", "payment_created"] },
      "payload.chargeId": String(chargeId),
      "payload.resolution": { $exists: false },
    };
    if (beforeDueRevision !== null) filter["payload.dueRevision"] = { $lt: beforeDueRevision };
    await Notification.updateMany({ ...filter, read: false }, { $set: { read: true, readAt: now } });
    await Notification.updateMany(filter, { $set: { "payload.resolution": resolution, "payload.resolvedAt": now } });
  },

  async markAllReadForTrainer(trainerId) {
    return Notification.updateMany(
      { trainerId, recipient: "trainer", read: false },
      { $set: { read: true, readAt: new Date() } }
    );
  },
};
