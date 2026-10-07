const nutritionalGoalDao = require("./nutritional-goal-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const userDao = require("../users/user-dao");
const trainerTaskDao = require("../trainerTasks/trainer-task-dao");
const { resolveClientNutritionTarget } = require("./nutrition-target-resolver");
const { stepsFromHabit } = require("../dietPhases/week-need");
const { addDaysToIsoDate } = require("../util/date-util");
const { todayForUser } = require("../users/user-time-zone");
const { conflict } = require("../util/http-error");
const { computeNutritionTarget } = require("./nutrition-target");
const { ageOn } = require("../users/age-policy");

module.exports = {
  async create(data) {
    return nutritionalGoalDao.create(data);
  },

  async getById(id) {
    return nutritionalGoalDao.findById(id);
  },

  // El objetivo en uso del usuario (User.goalInUse), o null.
  async getCurrentForUser(userId) {
    const goalId = await nutritionalGoalDao.goalInUseId(userId);
    return goalId ? nutritionalGoalDao.findById(goalId) : null;
  },

  // Crea un objetivo; si el usuario no tenía ninguno en uso, lo pone en uso.
  async createForUser(userId, data) {
    const goal = await nutritionalGoalDao.create({ userId, ...data });
    if (!(await nutritionalGoalDao.goalInUseId(userId))) await nutritionalGoalDao.setGoalInUse(userId, goal._id);
    return goal;
  },

  async activate(goal) {
    await nutritionalGoalDao.setGoalInUse(goal.userId, goal._id);
  },

  /**
   * Borra un objetivo (de su dueño `ownerFilterId`, o de cualquiera si es
   * null: admin). Nunca el último. Si era el que tenía en uso, pasa a estarlo
   * el más reciente. Devuelve el objetivo en uso que queda, o undefined si
   * no existía.
   */
  async removeGoal(goal, ownerFilterId) {
    if ((await nutritionalGoalDao.countByUserId(goal.userId)) <= 1) {
      throw conflict("Debes tener al menos un objetivo nutricional", "NUTRITIONAL_GOALS_MINIMUM_ONE");
    }
    const deleted = ownerFilterId
      ? await nutritionalGoalDao.deleteByIdAndUserId(goal._id, ownerFilterId)
      : await nutritionalGoalDao.delete(goal._id);
    if (!deleted) return undefined;

    const inUse = await nutritionalGoalDao.goalInUseId(goal.userId);
    if (String(inUse || "") !== String(goal._id)) return inUse;
    const fallback = await nutritionalGoalDao.findLatestByUserId(goal.userId);
    if (fallback?._id) {
      await nutritionalGoalDao.setGoalInUse(goal.userId, fallback._id);
      return fallback._id;
    }
    await nutritionalGoalDao.clearGoalInUse(goal.userId);
    return null;
  },

  async getByUserId(userId) {
    return nutritionalGoalDao.findByUserId(userId);
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

  // Recalcula el objetivo "Default" del cliente a partir de su perfil en
  // `User` y su último peso (Mifflin + gasto + reparto de macros — el mismo cálculo que hace
  // la app del cliente, ver nutrition-target.js). Lo usa el intake al
  // reescribir peso/pasos/etc.
  async recomputeDefaultForClient(clientId) {
    const [user, latestWeight, today] = await Promise.all([
      userDao.findFields(clientId, "height birth sex activity steps training objetive goalInUse"),
      anthropometryDao.findLatestWeight(clientId),
      todayForUser(clientId),
    ]);
    if (!user) return null;

    const target = computeNutritionTarget({
      weightKg: latestWeight?.weight ?? null,
      heightCm: user.height,
      age: ageOn(user.birth, today),
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
    await nutritionalGoalDao.setGoalInUse(clientId, goal._id);
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
    };
    const goalInUse = await nutritionalGoalDao.goalInUseId(clientId);
    if (goalInUse) {
      return { goal: await nutritionalGoalDao.update(goalInUse, data), created: false };
    }
    // El cliente todavía no tiene objetivo (nunca abrió la pantalla): se crea
    // y se pone en uso, igual que hace recomputeDefaultForClient.
    const goal = await nutritionalGoalDao.create({ userId: clientId, name: "Default", ...data });
    await nutritionalGoalDao.setGoalInUse(clientId, goal._id);
    return { goal, created: true };
  },

  /**
   * Lo que ve el profesional: el objetivo vigente del cliente y cómo se
   * calcularía hoy con sus ÚLTIMOS datos (último peso y pasos de su hábito en
   * las dos últimas semanas).
   */
  async clientGoalView(clientId) {
    const [goal, reference] = await Promise.all([this.getCurrentForUser(clientId), computeReference(clientId)]);
    return { goal, ...reference };
  },

  // Vuelve a "calculated" y recalcula: el objetivo manual deja de mandar
  // porque el profesional lo ha soltado a propósito. null si faltan datos.
  async recalculateForClient(clientId) {
    const goalInUse = await nutritionalGoalDao.goalInUseId(clientId);
    if (goalInUse) await nutritionalGoalDao.update(goalInUse, { source: "calculated", updatedByTrainerId: null });
    const goalId = await this.recomputeDefaultForClient(clientId);
    return goalId ? nutritionalGoalDao.findById(goalId) : null;
  },
};

async function computeReference(clientId) {
  const today = await todayForUser(clientId);
  const window = { start: addDaysToIsoDate(today, -14), end: today };
  const task = await trainerTaskDao.findActiveStepsTask(clientId);
  const completions = task ? await trainerTaskDao.listCompletionsForTasksInRange([task._id], window.start, window.end) : [];
  const steps = stepsFromHabit(task, completions.length, window, today);
  const resolved = await resolveClientNutritionTarget(clientId, 0, {}, {
    stepsRangeKey: steps?.key || null,
    useClientObjetive: true,
  });
  return { resolved, steps };
}

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}
