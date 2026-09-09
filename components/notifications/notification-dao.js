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

  async markAllReadForTrainer(trainerId) {
    return Notification.updateMany(
      { trainerId, recipient: "trainer", read: false },
      { $set: { read: true, readAt: new Date() } }
    );
  },
};
