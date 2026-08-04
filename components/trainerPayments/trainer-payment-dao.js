const TrainerPayment = require("./trainer-payment-schema");

module.exports = {
  async create(trainerId, clientId, { amount, currency, dueDate, note }) {
    return TrainerPayment.create({ trainerId, clientId, amount, currency, dueDate, note });
  },

  async list(trainerId, clientId) {
    return TrainerPayment.find({ trainerId, clientId }).sort({ dueDate: -1 }).lean();
  },

  async markPaid(trainerId, clientId, paymentId, paid) {
    return TrainerPayment.findOneAndUpdate(
      { _id: paymentId, trainerId, clientId },
      { $set: { paidAt: paid ? new Date() : null } },
      { new: true }
    ).lean();
  },

  // Cobros pendientes de un cliente, de CUALQUIER profesional (el controller
  // filtra por relación activa) — primera vía de lectura de lado cliente,
  // usada por el dashboard del tab Coach. Solo lectura: no existe pago real
  // in-app, es un recordatorio manual (ver schema).
  async listPendingForClient(clientId) {
    return TrainerPayment.find({ clientId, paidAt: null }).sort({ dueDate: 1 }).lean();
  },
};
