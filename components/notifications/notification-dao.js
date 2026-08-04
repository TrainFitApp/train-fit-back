const Notification = require("./notification-schema");

module.exports = {
  async create(clientId, trainerId, type, payload = {}) {
    return Notification.create({ clientId, trainerId, type, payload });
  },

  async listForClient(clientId, { unreadOnly } = {}) {
    const filter = { clientId };
    if (unreadOnly) filter.read = false;
    return Notification.find(filter).sort({ createdAt: -1 }).lean();
  },

  async countUnread(clientId) {
    return Notification.countDocuments({ clientId, read: false });
  },

  async markRead(clientId, notificationId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, clientId },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    ).lean();
  },

  async markAllRead(clientId) {
    return Notification.updateMany({ clientId, read: false }, { $set: { read: true, readAt: new Date() } });
  },
};
