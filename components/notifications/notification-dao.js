const Notification = require("./notification-schema");

module.exports = {
  async createForClient(clientId, trainerId, type, resourceType, resourceId) {
    return Notification.create({ clientId, trainerId, type, resourceType, resourceId });
  },

  async createForTrainer(trainerId, clientId, type, resourceType, resourceId) {
    return Notification.create({ trainerId, clientId, type, resourceType, resourceId });
  },

  async listForClient(clientId, { limit = 50 } = {}) {
    return Notification.find({ clientId }).sort({ createdAt: -1 }).limit(limit).lean();
  },

  async listForTrainer(trainerId, { limit = 50 } = {}) {
    return Notification.find({ trainerId }).sort({ createdAt: -1 }).limit(limit).lean();
  },

  async countUnreadForClient(clientId) {
    return Notification.countDocuments({ clientId, read: false });
  },

  async countUnreadForTrainer(trainerId) {
    return Notification.countDocuments({ trainerId, read: false });
  },

  async markRead(id) {
    return Notification.findByIdAndUpdate(
      id,
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );
  },

  async markAllReadForClient(clientId) {
    return Notification.updateMany(
      { clientId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
  },

  async markAllReadForTrainer(trainerId) {
    return Notification.updateMany(
      { trainerId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
  },
};
