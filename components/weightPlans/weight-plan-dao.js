const WeightPlan = require("./weight-plan-schema");

module.exports = {
  async findByTrainerAndClient(trainerId, clientId) {
    return WeightPlan.findOne({ trainerId, clientId }).lean();
  },

  async upsert(trainerId, clientId, { intervalDays, notes }) {
    return WeightPlan.findOneAndUpdate(
      { trainerId, clientId },
      { $set: { intervalDays, notes: notes || "" }, $setOnInsert: { lastReminderSentAt: null } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },

  async remove(trainerId, clientId) {
    return WeightPlan.findOneAndDelete({ trainerId, clientId }).lean();
  },

  // Lado cliente: sus pautas, de cualquier profesional. Normalmente una.
  async findByClient(clientId) {
    return WeightPlan.find({ clientId }).lean();
  },

  // Fase 6 — toda la cartera de un profesional en una consulta, para el
  // evaluador nocturno y la Cartera. Mismo criterio que
  // anthropometryDao.listForUsersSince: una consulta en lote, no una por
  // cliente.
  async findByTrainer(trainerId) {
    return WeightPlan.find({ trainerId }).lean();
  },

  // Para el cron. Poblado igual que el resto de servicios de recordatorio,
  // para poder nombrar al cliente y al profesional en el aviso.
  async findAllPopulated() {
    return WeightPlan.find({})
      .populate("clientId", "name lastname email")
      .populate("trainerId", "name lastname")
      .lean();
  },

  async markReminderSent(id, at) {
    return WeightPlan.updateOne({ _id: id }, { $set: { lastReminderSentAt: at } });
  },
};
