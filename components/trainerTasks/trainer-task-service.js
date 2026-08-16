const trainerTaskDao = require("./trainer-task-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const trainerClientSchema = require("../trainerClients/trainer-client-schema");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// Transversal a cualquier scope, igual que check-ins (funcionalidad 10) —
// una tarea diaria no pertenece a training ni a nutrition en concreto. Si
// el cliente tiene relación activa en ambos scopes, se ancla a la primera
// que se encuentre (el scope en sí no importa aquí, solo la generación de
// relación).
async function requireActiveRelationAnyScope(trainerId, clientId) {
  const training = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId, "training");
  if (training) return training;
  const nutrition = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId, "nutrition");
  if (nutrition) return nutrition;
  throw makeError(403, "NO_ACTIVE_RELATION", "No hay una relación activa con este cliente");
}

async function requireOwnedTask(trainerId, taskId) {
  const task = await trainerTaskDao.findById(taskId);
  if (!task) throw makeError(404, "TASK_NOT_FOUND", "Tarea no encontrada");
  const relation = await trainerClientDao.findById(task.trainerClientId);
  if (!relation || String(relation.trainerId) !== String(trainerId)) {
    throw makeError(404, "TASK_NOT_FOUND", "Tarea no encontrada");
  }
  return task;
}

module.exports = {
  async createForClient(trainerId, clientId, { type, name, target, unit }) {
    const relation = await requireActiveRelationAnyScope(trainerId, clientId);
    if (!target || target <= 0) {
      throw makeError(400, "TARGET_REQUIRED", "El objetivo debe ser mayor que 0");
    }
    const task = await trainerTaskDao.create({
      trainerClientId: relation._id,
      type,
      name: type === "custom" ? name : undefined,
      target,
      unit,
    });
    notificationService.notifyClient(clientId, trainerId, "task_assigned", "TrainerTask", task._id);
    return task;
  },

  async listForClient(trainerId, clientId) {
    const relation = await requireActiveRelationAnyScope(trainerId, clientId);
    return trainerTaskDao.findByTrainerClientId(relation._id, { includeInactive: true });
  },

  async update(trainerId, taskId, updates) {
    await requireOwnedTask(trainerId, taskId);
    return trainerTaskDao.update(taskId, updates);
  },

  async setActive(trainerId, taskId, active) {
    await requireOwnedTask(trainerId, taskId);
    return trainerTaskDao.setActive(taskId, active);
  },

  // --- Lado cliente ---

  async listMine(clientId) {
    // Un cliente puede tener varios trainers con relación activa —
    // agregamos las tareas de todas las relaciones activas suyas. Query
    // directo por clientId (los DAOs existentes de trainerClients solo
    // resuelven por trainerId+clientId, no "todos los trainers de este
    // cliente").
    const activeRelations = await trainerClientSchema
      .find({ clientId, status: "active" })
      .select("_id trainerId")
      .lean();

    const relationIds = activeRelations.map((r) => r._id);
    if (relationIds.length === 0) return [];

    const tasks = await Promise.all(
      relationIds.map((id) => trainerTaskDao.findByTrainerClientId(id))
    );
    return tasks.flat();
  },

  async listCompletions(clientId, taskIds, range) {
    // Verificación de contención: los taskIds deben pertenecer a relaciones
    // activas de este cliente (nunca confiar en ids sueltos, ver
    // funcionalidad 5).
    const myTasks = await this.listMine(clientId);
    const myTaskIds = new Set(myTasks.map((t) => String(t._id)));
    const validIds = taskIds.filter((id) => myTaskIds.has(String(id)));
    return trainerTaskDao.findCompletionsByTaskIds(validIds, range);
  },

  async setCompletion(clientId, taskId, date, completed) {
    const myTasks = await this.listMine(clientId);
    const owns = myTasks.some((t) => String(t._id) === String(taskId));
    if (!owns) throw makeError(404, "TASK_NOT_FOUND", "Tarea no encontrada");
    return trainerTaskDao.upsertCompletion(taskId, date, completed);
  },
};
