const notificationDao = require("./notification-dao");
const userSchema = require("../users/schema");

module.exports = {
  // GET /notifications/mine?unreadOnly=1
  async listMine(req, res) {
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";
    const notifications = await notificationDao.listForClient(req.auth.userId, { unreadOnly });

    const trainerIds = [...new Set(notifications.map((n) => String(n.trainerId)))];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    return res.send(
      notifications.map((n) => ({ ...n, trainer: trainersById.get(String(n.trainerId)) || null }))
    );
  },

  // GET /notifications/mine/unread-count — chequeo barato para el badge del
  // tab Coach, sin traer el listado completo.
  async countUnread(req, res) {
    const count = await notificationDao.countUnread(req.auth.userId);
    return res.send({ count });
  },

  // PATCH /notifications/:id/read
  async markRead(req, res) {
    const notification = await notificationDao.markRead(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.send(notification);
  },

  // POST /notifications/mark-all-read
  async markAllRead(req, res) {
    await notificationDao.markAllRead(req.auth.userId);
    return res.sendStatus(204);
  },

  // --- Dashboard trainer (2026-08-18) — mismo patrón, sentido inverso: aquí
  // el destinatario es el trainer y hay que enriquecer con el CLIENTE que
  // disparó cada evento, no con el trainer (ya lo es el propio lector).
  // GET /trainer/notifications/mine?unreadOnly=1
  async listMineTrainer(req, res) {
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";
    const notifications = await notificationDao.listForTrainer(req.auth.userId, { unreadOnly });

    const clientIds = [...new Set(notifications.map((n) => String(n.clientId)))];
    const clients = await userSchema.find({ _id: { $in: clientIds } }).select("name lastname email").lean();
    const clientsById = new Map(clients.map((c) => [String(c._id), c]));

    return res.send(
      notifications.map((n) => ({ ...n, client: clientsById.get(String(n.clientId)) || null }))
    );
  },

  // GET /trainer/notifications/mine/unread-count
  async countUnreadTrainer(req, res) {
    const count = await notificationDao.countUnreadForTrainer(req.auth.userId);
    return res.send({ count });
  },

  // PATCH /trainer/notifications/:id/read
  async markReadTrainer(req, res) {
    const notification = await notificationDao.markReadForTrainer(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.send(notification);
  },

  // POST /trainer/notifications/mark-all-read
  async markAllReadTrainer(req, res) {
    await notificationDao.markAllReadForTrainer(req.auth.userId);
    return res.sendStatus(204);
  },
};
