const notificationDao = require("./notification-dao");

// Invocado desde los distintos dominios al ocurrir el evento correspondiente
// (funcionalidad 15) — nunca debe romper la acción principal si falla,
// mismo criterio que notifyInvite() en trainer-client-service.js (M2).
function safeCreate(promise, context) {
  promise.catch((error) => {
    console.error("[NOTIFICATIONS] create_failed", { ...context, message: error?.message });
  });
}

module.exports = {
  notifyClient(clientId, trainerId, type, resourceType, resourceId) {
    safeCreate(notificationDao.createForClient(clientId, trainerId, type, resourceType, resourceId), {
      clientId,
      type,
    });
  },

  notifyTrainer(trainerId, clientId, type, resourceType, resourceId) {
    safeCreate(notificationDao.createForTrainer(trainerId, clientId, type, resourceType, resourceId), {
      trainerId,
      type,
    });
  },

  async listMine(userId, isTrainer) {
    return isTrainer
      ? notificationDao.listForTrainer(userId)
      : notificationDao.listForClient(userId);
  },

  async getUnreadCount(userId, isTrainer) {
    const count = isTrainer
      ? await notificationDao.countUnreadForTrainer(userId)
      : await notificationDao.countUnreadForClient(userId);
    return { count };
  },

  async markRead(id) {
    return notificationDao.markRead(id);
  },

  async markAllRead(userId, isTrainer) {
    return isTrainer
      ? notificationDao.markAllReadForTrainer(userId)
      : notificationDao.markAllReadForClient(userId);
  },
};
