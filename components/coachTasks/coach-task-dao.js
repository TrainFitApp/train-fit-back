const CoachTask = require("./coach-task-schema");
const mongoose = require("mongoose");

module.exports = {
  async create(trainerId, data) {
    if (data.clientId && !data.stageId) {
      const { stage } = await require("../clientOverview/stage-service").resolveStage(trainerId, data.clientId, null, { write: true });
      data = { ...data, stageId: stage._id };
    }
    return CoachTask.create({ trainerId, ...data });
  },

  // Pendientes primero y por fecha de vencimiento. Las tareas sin dueDate
  // (null) quedan al final: Mongo ordena null antes que cualquier string en
  // ascendente, así que se ordena por un campo derivado que las empuja al
  // fondo — una tarea sin fecha nunca es más urgente que una con fecha.
  async listForTrainer(trainerId, { status, clientId, stageId, limit = 100 } = {}) {
    const filter = { trainerId: new mongoose.Types.ObjectId(trainerId) };
    if (status) filter.status = status;
    if (clientId) filter.clientId = new mongoose.Types.ObjectId(clientId);
    if (stageId) filter.stageId = new mongoose.Types.ObjectId(stageId);
    const tasks = await CoachTask.aggregate([
      { $match: filter },
      { $lookup: { from: "trainerclients", let: { client: "$clientId", trainer: "$trainerId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$clientId", "$$client"] }, { $eq: ["$trainerId", "$$trainer"] }, { $eq: ["$status", "active"] }] } } }], as: "_relations" } },
      { $match: { $expr: { $or: [{ $eq: [{ $ifNull: ["$clientId", null] }, null] }, { $and: [{ $gt: [{ $size: "$_relations" }, 0] }, { $or: [{ $eq: [{ $ifNull: ["$stageId", null] }, null] }, { $in: ["$stageId", "$_relations.stageId"] }] }] }] } } },
      { $addFields: { _doneOrder: { $cond: [{ $eq: ["$status", "pending"] }, 0, 1] }, _missingDate: { $cond: [{ $ifNull: ["$dueDate", false] }, 0, 1] } } },
      { $sort: { _doneOrder: 1, _missingDate: 1, dueDate: 1, createdAt: -1, _id: -1 } },
      { $limit: Math.min(Math.max(1, limit), 500) }, { $project: { _relations: 0, _doneOrder: 0, _missingDate: 0 } },
    ]);
    return CoachTask.populate(tasks, { path: "clientId", select: "name lastname" });
  },

  // trainerId siempre en el filtro, nunca solo el _id — mismo criterio que
  // el resto de DAOs del módulo trainer.
  async update(trainerId, id, updates) {
    const existing = await CoachTask.findOne({ _id: id, trainerId }).lean();
    if (existing?.clientId) await require("../clientOverview/stage-service").resolveStage(trainerId, existing.clientId, existing.stageId, { write: true });
    return CoachTask.findOneAndUpdate({ _id: id, trainerId }, { $set: { ...updates, updatedAt: new Date() }, $inc: { version: 1 } }, { new: true, runValidators: true }).lean();
  },

  async remove(trainerId, id) {
    const existing = await CoachTask.findOne({ _id: id, trainerId }).lean();
    if (existing?.clientId) await require("../clientOverview/stage-service").resolveStage(trainerId, existing.clientId, existing.stageId, { write: true });
    return CoachTask.findOneAndDelete({ _id: id, trainerId });
  },
};

// Pendientes antes que hechas; dentro de cada grupo, por vencimiento
// ascendente con las sin-fecha al final; a igualdad, la más reciente arriba.
function byUrgency(a, b) {
  if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
