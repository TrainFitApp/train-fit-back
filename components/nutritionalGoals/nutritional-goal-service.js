const nutritionalGoalDao = require("./nutritional-goal-dao");
const userSchema = require("../users/schema");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  async create(data) {
    return nutritionalGoalDao.create(data);
  },

  async getById(id) {
    return nutritionalGoalDao.findById(id);
  },

  async getByIdAndUserId(id, userId) {
    return nutritionalGoalDao.findByIdAndUserId(id, userId);
  },

  async getByUserId(userId) {
    return nutritionalGoalDao.findByUserId(userId);
  },

  async getLatestByUserId(userId) {
    return nutritionalGoalDao.findLatestByUserId(userId);
  },

  async countByUserId(userId) {
    return nutritionalGoalDao.countByUserId(userId);
  },

  async update(id, data) {
    return nutritionalGoalDao.update(id, data);
  },

  async updateByUserId(id, userId, data) {
    return nutritionalGoalDao.updateByUserId(id, userId, data);
  },

  async remove(id) {
    return nutritionalGoalDao.delete(id);
  },

  async removeByUserId(id, userId) {
    return nutritionalGoalDao.deleteByIdAndUserId(id, userId);
  },

  // Funcionalidad 7 — de un cliente a la vez, sin bulk-apply. Actualiza el
  // objetivo activo del cliente si tiene uno, o crea uno nuevo y lo activa
  // (mismo criterio que create() del cliente: primer objetivo = activo).
  async assignByTrainer(trainerId, clientId, { kcalTotal, proteinsGTotal, carbohydratesGTotal, fatGTotal, period }) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");

    if (!period || !period.startDate || !period.endMode) {
      throw makeError(400, "INVALID_PERIOD", "Vigencia inválida");
    }

    const fields = {
      kcalTotal: kcalTotal || 0,
      proteinsGTotal: proteinsGTotal || 0,
      carbohydratesGTotal: carbohydratesGTotal || 0,
      fatGTotal: fatGTotal || 0,
      assignedByTrainerId: trainerId,
      period,
    };

    const client = await userSchema.findById(clientId).select("goalInUse");
    if (client?.goalInUse) {
      const updated = await nutritionalGoalDao.update(client.goalInUse, fields);
      if (updated) {
        notificationService.notifyClient(clientId, trainerId, "goal_assigned", "NutritionalGoal", updated._id);
        return updated;
      }
    }

    const created = await nutritionalGoalDao.create({
      userId: clientId,
      name: "Asignado por entrenador",
      ...fields,
    });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: created._id } });
    notificationService.notifyClient(clientId, trainerId, "goal_assigned", "NutritionalGoal", created._id);
    return created;
  },
};
