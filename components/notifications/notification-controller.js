const notificationDao = require("./notification-dao");
const userSchema = require("../users/schema");
const trainerPaymentService = require("../trainerPayments/trainer-payment-service");
const paymentReminders = require("../trainerPayments/trainer-payment-reminder-service");

// Cobros 2026-09 — sin cron: los avisos de cobro se crean al leer (lista o
// contador) si ya toca alguno (trainer-payment-reminder-service.js). Y
// llevan el estado VIGENTE del cobro
// (saldo de ahora, o cerrado) en payload.current. Si esa lectura falla, la
// lista sale igual, sin el añadido: nunca se inventa un saldo.
async function withPaymentState(notifications, audience, trainerId) {
  try {
    return await trainerPaymentService.enrichNotifications(notifications, audience, trainerId);
  } catch (error) {
    console.error("[Notifications] No se pudo añadir el estado de los cobros:", error.message);
    return notifications;
  }
}

module.exports = {
  // GET /notifications/mine?unreadOnly=1
  async listMine(req, res) {
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";
    await paymentReminders.ensureClientUpToDate(req.auth.userId);
    const notifications = await withPaymentState(
      await notificationDao.listForClient(req.auth.userId, { unreadOnly }),
      "client"
    );

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
    await paymentReminders.ensureClientUpToDate(req.auth.userId);
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

  // DELETE /notifications/:id
  async remove(req, res) {
    const notification = await notificationDao.deleteForClient(req.auth.userId, req.params.id);
    if (!notification) return res.status(404).send({ message: "Notificación no encontrada" });
    return res.sendStatus(204);
  },

  // --- Dashboard trainer (2026-08-18) — mismo patrón, sentido inverso: aquí
  // el destinatario es el trainer y hay que enriquecer con el CLIENTE que
  // disparó cada evento, no con el trainer (ya lo es el propio lector).
  // GET /trainer/notifications/mine?unreadOnly=1
  async listMineTrainer(req, res) {
    const unreadOnly = req.query.unreadOnly === "1" || req.query.unreadOnly === "true";
    await paymentReminders.ensureTrainerUpToDate(req.auth.userId);
    const notifications = await withPaymentState(
      await notificationDao.listForTrainer(req.auth.userId, { unreadOnly }),
      "trainer",
      req.auth.userId
    );

    const clientIds = [...new Set(notifications.map((n) => String(n.clientId)))];
    const clients = await userSchema.find({ _id: { $in: clientIds } }).select("name lastname email").lean();
    const clientsById = new Map(clients.map((c) => [String(c._id), c]));

    return res.send(
      notifications.map((n) => ({ ...n, client: clientsById.get(String(n.clientId)) || null }))
    );
  },

  // GET /trainer/notifications/mine/unread-count
  async countUnreadTrainer(req, res) {
    await paymentReminders.ensureTrainerUpToDate(req.auth.userId);
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
