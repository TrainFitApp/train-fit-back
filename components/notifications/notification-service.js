const notificationDao = require("./notification-dao");
const userDao = require("../users/user-dao");
const trainerPaymentService = require("../trainerPayments/trainer-payment-service");
const paymentReminders = require("../trainerPayments/trainer-payment-reminder-service");

// Avisos del cliente y del profesional (notification-schema.js).
//
// Cobros: sin cron, los avisos de cobro se crean al leer (lista o contador)
// si ya toca alguno (trainer-payment-reminder-service.js), y llevan el estado
// VIGENTE del cobro (saldo de ahora, o cerrado) en payload.current. Si esa
// lectura falla, la lista sale igual, sin el añadido: nunca se inventa un
// saldo.
async function withPaymentState(notifications, audience, trainerId) {
  try {
    return await trainerPaymentService.enrichNotifications(notifications, audience, trainerId);
  } catch (error) {
    console.error("[Notifications] No se pudo añadir el estado de los cobros:", error.message);
    return notifications;
  }
}

// Cada aviso con el usuario del otro lado (`as`), solo con `fields`.
async function withCounterpart(notifications, idField, as, fields) {
  const ids = [...new Set(notifications.map((n) => String(n[idField])))];
  const byId = new Map((await userDao.listFields(ids, fields)).map((user) => [String(user._id), user]));
  return notifications.map((n) => ({ ...n, [as]: byId.get(String(n[idField])) || null }));
}

module.exports = {
  // Crear un aviso (lo usan los demás módulos): para el cliente o para el
  // profesional.
  create: (clientId, trainerId, type, payload) => notificationDao.create(clientId, trainerId, type, payload),
  createForTrainer: (trainerId, clientId, type, payload) => notificationDao.createForTrainer(trainerId, clientId, type, payload),

  // --- Cliente ---
  async listForClient(clientId, { unreadOnly }) {
    await paymentReminders.ensureClientUpToDate(clientId);
    const notifications = await withPaymentState(await notificationDao.listForClient(clientId, { unreadOnly }), "client");
    return withCounterpart(notifications, "trainerId", "trainer", "name lastname");
  },
  async countUnreadForClient(clientId) {
    await paymentReminders.ensureClientUpToDate(clientId);
    return notificationDao.countUnread(clientId);
  },
  markRead: (clientId, id) => notificationDao.markRead(clientId, id),
  markAllRead: (clientId) => notificationDao.markAllRead(clientId),
  deleteForClient: (clientId, id) => notificationDao.deleteForClient(clientId, id),

  // --- Profesional (el destinatario es él; cada aviso lleva el cliente que
  // lo disparó) ---
  async listForTrainer(trainerId, { unreadOnly }) {
    await paymentReminders.ensureTrainerUpToDate(trainerId);
    const notifications = await withPaymentState(
      await notificationDao.listForTrainer(trainerId, { unreadOnly }),
      "trainer",
      trainerId
    );
    return withCounterpart(notifications, "clientId", "client", "name lastname email");
  },
  async countUnreadForTrainer(trainerId) {
    await paymentReminders.ensureTrainerUpToDate(trainerId);
    return notificationDao.countUnreadForTrainer(trainerId);
  },
  markReadForTrainer: (trainerId, id) => notificationDao.markReadForTrainer(trainerId, id),
  markAllReadForTrainer: (trainerId) => notificationDao.markAllReadForTrainer(trainerId),
};
