const { Supplement } = require("./supplement-schema");

module.exports = {
  async listForClient(trainerId, clientId) {
    return Supplement.find({ trainerId, clientId }).sort({ createdAt: 1 }).lean();
  },

  // Los suplementos que ve EL CLIENTE: de todos sus profesionales, y solo
  // los activos. Sin trainerId a propósito — el cliente no distingue quién
  // se lo pautó cuando va a tomárselo. El controller filtra por relación
  // activa, mismo criterio que trainer-task-dao#listActiveForClient.
  async listActiveForClient(clientId) {
    return Supplement.find({ clientId, active: true }).sort({ createdAt: 1 }).lean();
  },

  async create(trainerId, clientId, data) {
    return Supplement.create({ ...data, trainerId, clientId });
  },

  // trainerId en el filtro, no solo el _id: impide editar el suplemento que
  // pautó otro profesional al mismo cliente.
  async update(trainerId, clientId, id, data) {
    return Supplement.findOneAndUpdate(
      { _id: id, trainerId, clientId },
      { $set: data },
      { new: true }
    ).lean();
  },

  async remove(trainerId, clientId, id) {
    return Supplement.deleteOne({ _id: id, trainerId, clientId });
  },
};
