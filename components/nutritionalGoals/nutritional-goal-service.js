const nutritionalGoalDao = require("./nutritional-goal-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

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

  // MVP-trainers D10 — mismo criterio que table-service.js#countEffectiveUserTables.
  async countEffectiveUserGoals(userId) {
    const hasActiveNutrition = await trainerClientDao.hasActiveRelation(userId, "nutrition");
    return hasActiveNutrition
      ? nutritionalGoalDao.countOwnByUserId(userId)
      : nutritionalGoalDao.countByUserId(userId);
  },

  // Para la lógica de "bloqueo" (isGoalLockedForPlan en el controller): indica
  // si hay relación nutrition activa AHORA (los objetivos asignados nunca se
  // bloquean mientras dure) y qué objetivos cuentan contra el límite.
  async getGoalsForLockCheck(userId) {
    const [hasActiveNutrition, allGoals] = await Promise.all([
      trainerClientDao.hasActiveRelation(userId, "nutrition"),
      nutritionalGoalDao.findByUserId(userId),
    ]);
    const relevantGoals = hasActiveNutrition
      ? allGoals.filter((g) => !g.assignedByTrainerId)
      : allGoals;
    return { hasActiveNutrition, allGoals, relevantGoals };
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
};
