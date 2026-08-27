const CoachTask = require("./coach-task-schema");

module.exports = {
  async create(trainerId, data) {
    return CoachTask.create({ trainerId, ...data });
  },

  // Pendientes primero y por fecha de vencimiento. Las tareas sin dueDate
  // (null) quedan al final: Mongo ordena null antes que cualquier string en
  // ascendente, así que se ordena por un campo derivado que las empuja al
  // fondo — una tarea sin fecha nunca es más urgente que una con fecha.
  async listForTrainer(trainerId, { status, limit = 100 } = {}) {
    const filter = { trainerId };
    if (status) filter.status = status;

    const tasks = await CoachTask.find(filter)
      .limit(limit)
      .populate("clientId", "name lastname")
      .lean();

    return tasks.sort(byUrgency);
  },

  // trainerId siempre en el filtro, nunca solo el _id — mismo criterio que
  // el resto de DAOs del módulo trainer.
  async update(trainerId, id, updates) {
    return CoachTask.findOneAndUpdate({ _id: id, trainerId }, { $set: updates }, { new: true }).lean();
  },

  async remove(trainerId, id) {
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
