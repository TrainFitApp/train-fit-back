const notificationService = require("./notification-service");

const unreadOnlyOf = (req) => req.query.unreadOnly === "1" || req.query.unreadOnly === "true";

module.exports = {
  // GET /notifications/mine?unreadOnly=1 — cada aviso con su profesional.
  async listMine(req, res) {
    return res.send(await notificationService.listForClient(req.auth.userId, { unreadOnly: unreadOnlyOf(req) }));
  },

  // GET /notifications/mine/unread-count — chequeo barato para el badge del
  // tab Coach, sin traer el listado completo.
  async countUnread(req, res) {
    return res.send({ count: await notificationService.countUnreadForClient(req.auth.userId) });
  },

  // PATCH /notifications/:id/read
  async markRead(req, res) {
    const notification = await notificationService.markRead(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.send(notification);
  },

  // POST /notifications/mark-all-read
  async markAllRead(req, res) {
    await notificationService.markAllRead(req.auth.userId);
    return res.sendStatus(204);
  },

  // DELETE /notifications/:id
  async remove(req, res) {
    const notification = await notificationService.deleteForClient(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.sendStatus(204);
  },

  // --- Profesional: el destinatario es él y cada aviso lleva el CLIENTE que
  // lo disparó.
  // GET /trainer/notifications/mine?unreadOnly=1
  async listMineTrainer(req, res) {
    return res.send(await notificationService.listForTrainer(req.auth.userId, { unreadOnly: unreadOnlyOf(req) }));
  },

  // GET /trainer/notifications/mine/unread-count
  async countUnreadTrainer(req, res) {
    return res.send({ count: await notificationService.countUnreadForTrainer(req.auth.userId) });
  },

  // PATCH /trainer/notifications/:id/read
  async markReadTrainer(req, res) {
    const notification = await notificationService.markReadForTrainer(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.send(notification);
  },

  // POST /trainer/notifications/mark-all-read
  async markAllReadTrainer(req, res) {
    await notificationService.markAllReadForTrainer(req.auth.userId);
    return res.sendStatus(204);
  },
};
