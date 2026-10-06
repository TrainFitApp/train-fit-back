const CoachRule = require("./coach-rule-schema");

module.exports = {
  async create(trainerId, data) {
    return CoachRule.create({ trainerId, ...data });
  },

  async listForTrainer(trainerId) {
    return CoachRule.find({ trainerId }).sort({ createdAt: -1 }).lean();
  },

  async listEnabledForTrainer(trainerId) {
    return CoachRule.find({ trainerId, enabled: true }).lean();
  },

  async findOwned(trainerId, id) {
    return CoachRule.findOne({ _id: id, trainerId }).lean();
  },

  // trainerId siempre en el filtro, nunca solo el _id — mismo criterio que
  // el resto de DAOs del módulo.
  async update(trainerId, id, updates) {
    return CoachRule.findOneAndUpdate(
      { _id: id, trainerId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
  },

  async remove(trainerId, id) {
    return CoachRule.findOneAndDelete({ _id: id, trainerId });
  },

  // Todas las reglas evaluadas en una pasada, en una escritura.
  async markEvaluated(ids, when) {
    // Evaluarla no es editarla: no cambia updatedAt.
    return CoachRule.updateMany({ _id: { $in: ids } }, { $set: { lastEvaluatedAt: when } }, { timestamps: false });
  },

  // Freno de emergencia: la regla afectó a más clientes de la cuenta en una
  // sola pasada. Se apaga sola y guarda el motivo para que la pantalla de
  // reglas pueda explicarlo en vez de mostrar un interruptor apagado sin
  // más.
  async disableWithReason(id, reason) {
    return CoachRule.updateOne(
      { _id: id },
      { $set: { enabled: false, disabledReason: reason } }
    );
  },
};
