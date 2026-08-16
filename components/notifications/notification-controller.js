const notificationService = require("./notification-service");

function isTrainer(req) {
  return (req.user.roles || []).includes("trainer");
}

module.exports = {
  async listMine(req, res) {
    const notifications = await notificationService.listMine(req.user.id, isTrainer(req));
    return res.send(notifications);
  },

  async getUnreadCount(req, res) {
    const result = await notificationService.getUnreadCount(req.user.id, isTrainer(req));
    return res.send(result);
  },

  async markRead(req, res) {
    const notification = await notificationService.markRead(req.params.id);
    return res.send(notification);
  },

  async markAllRead(req, res) {
    await notificationService.markAllRead(req.user.id, isTrainer(req));
    return res.send({ marked: true });
  },
};
