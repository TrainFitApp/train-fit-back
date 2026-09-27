const nutritionalGoalDao = require("./nutritional-goal-dao");
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

  // Recalcula el objetivo "Default" del cliente a partir de su perfil en
  // `User` (Mifflin + gasto + reparto de macros — el mismo cálculo que hace
  // la app del cliente, ver nutrition-target.js). Lo usa el intake al
  // reescribir peso/pasos/etc.
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
      source: "calculated",
      kcalTotal: target.kcal,
      proteinsGTotal: round1(target.protein),
      carbohydratesGTotal: round1(target.carbs),
      fatGTotal: round1(target.fat),
      updatedAt: new Date(),
    };

    const current = user.goalInUse ? await nutritionalGoalDao.findById(user.goalInUse) : null;
    // Un objetivo MANUAL no se pisa al recalcular: alguien (el cliente o su
    // profesional) decidió esas kcal a propósito, y cambiar de peso no puede
    // borrárselas por detrás. Para volver al calculado hay que pedirlo.
    if (current?.source === "manual") return current._id;
    if (current) {
      await nutritionalGoalDao.update(current._id, macros);
      return current._id;
    }
    // Sin objetivo activo: crear el Default y ponerlo en uso.
    const goal = await nutritionalGoalDao.create({ userId: clientId, name: "Default", ...macros });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    return goal._id;
  },

  // El profesional fija kcal y macros a mano: el objetivo pasa a "manual" y
  // recalcular desde el perfil deja de pisarlo. Lo usan "Objetivo
  // nutricional" en la ficha y aplicar un protocolo. `updates` ya validado.
  // Devuelve { goal, created }.
  async setManualGoalForClient(trainerId, clientId, updates) {
    const data = {
      ...updates,
      source: "manual",
      updatedByTrainerId: trainerId,
      updatedAt: new Date(),
    };
    const user = await userSchema.findById(clientId).select("goalInUse").lean();
    if (user?.goalInUse) {
      return { goal: await nutritionalGoalDao.update(user.goalInUse, data), created: false };
    }
    // El cliente todavía no tiene objetivo (nunca abrió la pantalla): se crea
    // y se pone en uso, igual que hace recomputeDefaultForClient.
    const goal = await nutritionalGoalDao.create({ userId: clientId, name: "Default", ...data });
    await userSchema.findByIdAndUpdate(clientId, { $set: { goalInUse: goal._id } });
    return { goal, created: true };
  },
};

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
