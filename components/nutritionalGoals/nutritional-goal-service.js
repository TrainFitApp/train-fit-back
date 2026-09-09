const nutritionalGoalDao = require("./nutritional-goal-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");

module.exports = {
  async create(data) {
    return nutritionalGoalDao.create(data);
  },

  // Sugerencias de dieta — cada ciclo de una fase crea su objetivo junto a
  // su copia de dieta, con el mismo phaseId y las fechas del ciclo, y pasa a
  // ser el vigente (goalInUse). El histórico de objetivos anteriores se
  // conserva (no se borran), igual que en assignNutritionalGoal.
  async assignToClient({ clientId, trainerId, kcal, macros = {}, phaseId, cycleId, startDate, name }) {
    const goal = await nutritionalGoalDao.create({
      userId: clientId,
      assignedByTrainerId: trainerId,
      name: name || "Objetivo de la fase",
      kcalTotal: Math.round(kcal || 0),
      proteinsGTotal: round1(macros.protein),
      carbohydratesGTotal: round1(macros.carbs),
      fatGTotal: round1(macros.fat),
      phaseId: phaseId || null,
      cycleId: cycleId || null,
      startDate: startDate || null,
      endMode: "indefinite",
      endDate: null,
    });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    return goal;
  },

  // Sugerencias de dieta — al quitar una fase/ciclo, se borra también el
  // objetivo que ese ciclo creó, y si era el vigente (goalInUse) se repunta:
  // al objetivo del ciclo que queda como tip, o al último objetivo del
  // cliente que NO pertenece a una fase (el "de siempre"), o a null.
  async cleanupCycleGoal(clientId, cycleId, { fallbackCycleId = null } = {}) {
    const NutritionalGoal = require("./nutritional-goal-schema");
    const toRemove = await NutritionalGoal.find({ userId: clientId, cycleId }).select("_id").lean();
    if (!toRemove.length) return;
    const removedIds = toRemove.map((g) => String(g._id));

    await NutritionalGoal.deleteMany({ _id: { $in: removedIds } });

    const client = await userSchema.findById(clientId).select("goalInUse").lean();
    if (!client?.goalInUse || !removedIds.includes(String(client.goalInUse))) return;

    let next = null;
    if (fallbackCycleId) {
      next = await NutritionalGoal.findOne({ userId: clientId, cycleId: fallbackCycleId })
        .sort({ createdAt: -1 })
        .select("_id")
        .lean();
    }
    if (!next) {
      next = await NutritionalGoal.findOne({
        userId: clientId,
        $or: [{ phaseId: null }, { phaseId: { $exists: false } }],
      })
        .sort({ createdAt: -1 })
        .select("_id")
        .lean();
    }
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: next?._id || null } });
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

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
