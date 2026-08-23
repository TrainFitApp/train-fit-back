const AnthropometryRequest = require("./anthropometry-request-schema");

module.exports = {
  async findByTrainerAndClient(trainerId, clientId) {
    return AnthropometryRequest.findOne({ trainerId, clientId }).lean();
  },

  async upsert(trainerId, clientId, { fields, notes, cadence, customIntervalDays }) {
    return AnthropometryRequest.findOneAndUpdate(
      { trainerId, clientId },
      {
        $set: {
          fields,
          notes: notes || "",
          cadence,
          customIntervalDays: cadence === "custom" ? customIntervalDays : null,
          active: true,
          lastRequestedAt: new Date(),
          lastReminderSentAt: null,
        },
      },
      { new: true, upsert: true }
    ).lean();
  },

  async cancel(trainerId, clientId) {
    return AnthropometryRequest.findOneAndDelete({ trainerId, clientId }).lean();
  },

  // Lado cliente — todas sus peticiones activas, de cualquier trainer.
  async findActiveByClient(clientId) {
    return AnthropometryRequest.find({ clientId, active: true }).lean();
  },

  // Se llama tras CUALQUIER guardado de antropometría propio del cliente
  // (ver anthropometry-controller.js) — no distingue qué campos concretos
  // mandó frente a los pedidos: si el cliente ya está registrando medidas,
  // cuenta como atendida, igual de simple que "marcar como leído".
  async markFulfilledForClient(clientId) {
    await AnthropometryRequest.updateMany(
      { clientId, active: true, cadence: "once" },
      { $set: { active: false, lastFulfilledAt: new Date() } }
    );
    await AnthropometryRequest.updateMany(
      { clientId, active: true, cadence: { $ne: "once" } },
      { $set: { lastFulfilledAt: new Date(), lastReminderSentAt: null } }
    );
  },

  // Para el cron de recordatorios — mismo criterio que
  // checkin-reminder-service.js#findDueReminders: solo las recurrentes,
  // "once" nunca vuelve a avisar tras la petición inicial.
  async findActiveRecurring() {
    return AnthropometryRequest.find({ active: true, cadence: { $ne: "once" } })
      .populate("clientId", "name lastname email")
      .populate("trainerId", "name lastname")
      .lean();
  },

  async markReminderSent(id, at) {
    return AnthropometryRequest.updateOne({ _id: id }, { $set: { lastReminderSentAt: at } });
  },
};
