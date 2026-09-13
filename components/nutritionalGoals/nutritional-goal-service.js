const nutritionalGoalDao = require("./nutritional-goal-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");
const { computeNutritionTarget } = require("./nutrition-target");

function ageFromBirth(birth) {
  if (!birth) return null;
  const ms = Date.now() - new Date(birth).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
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

  // Recalcula el objetivo "Default" del cliente a partir de su perfil en
  // `User` (Mifflin + gasto + reparto de macros — el mismo cálculo que hace
  // la app del cliente, ver nutrition-target.js). Lo usa el intake al
  // reescribir peso/pasos/etc. NO pisa un objetivo asignado por un
  // profesional (assignedByTrainerId) — ese es una prescripción.
  async recomputeDefaultForClient(clientId) {
    const user = await userSchema
      .findById(clientId)
      .select("weight height birth sex activity steps training objetive goalInUse")
      .lean();
    if (!user) return null;

    const target = computeNutritionTarget({
      weightKg: user.weight,
      heightCm: user.height,
      age: ageFromBirth(user.birth),
      sex: user.sex,
      activity: user.activity,
      steps: user.steps,
      training: user.training,
      objetiveKcalDelta: Number.isFinite(user.objetive) ? user.objetive : 0,
    });
    if (!target) return null; // faltan biométricos, nada que recalcular

    const macros = {
      kcalTotal: target.kcal,
      proteinsGTotal: round1(target.protein),
      carbohydratesGTotal: round1(target.carbs),
      fatGTotal: round1(target.fat),
      updatedAt: new Date(),
    };

    const current = user.goalInUse ? await nutritionalGoalDao.findById(user.goalInUse) : null;
    if (current && !current.assignedByTrainerId) {
      await nutritionalGoalDao.update(current._id, macros);
      return current._id;
    }
    if (current && current.assignedByTrainerId) {
      return null; // prescripción de un profesional — no se toca
    }
    // Sin objetivo activo: crear el Default y ponerlo en uso.
    const goal = await nutritionalGoalDao.create({ userId: clientId, name: "Default", ...macros });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    return goal._id;
  },
};

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
