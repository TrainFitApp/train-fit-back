const nutritionalGoalService = require("./nutritional-goal-service");
const featureAccessService = require("../billing/feature-access-service");
const userSchema = require("../users/schema");

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function ownsGoal(req, goal) {
  return String(goal?.userId || "") === String(req.user?.id || "");
}

function canAccessGoal(req, goal) {
  return isAdmin(req) || ownsGoal(req, goal);
}

function sanitizeGoalInput(body) {
  return {
    name: body.name,
    kcalTotal: body.kcalTotal,
    proteinsGTotal: body.proteinsGTotal,
    carbohydratesGTotal: body.carbohydratesGTotal,
    fatGTotal: body.fatGTotal,
  };
}

function sendLockedGoal(res) {
  return res.status(403).send({
    message: "Este objetivo nutricional esta bloqueado en el modo Free",
    code: "NUTRITIONAL_GOAL_LOCKED",
  });
}

// El cliente ve y activa un objetivo pautado por su entrenador, pero no lo
// edita ni lo borra (ni siquiera vacío/name) — para eso está el chat con el
// entrenador. El propio trainer sigue pudiendo cambiarlo, pero por SU
// endpoint (trainer-client-data-controller.js#assignNutritionalGoal, que
// crea un objetivo nuevo y lo activa), no por esta ruta de cliente.
function sendTrainerAssignedGoal(res) {
  return res.status(403).send({
    message: "Este objetivo lo pauto tu entrenador, no se puede editar ni borrar desde aqui",
    code: "NUTRITIONAL_GOAL_TRAINER_ASSIGNED",
  });
}

function getGoalId(goal) {
  return String(goal?._id || "");
}

function getFreeUnlockedGoalId(user, goals) {
  if (!Array.isArray(goals) || goals.length === 0) return "";

  const activeGoalId = String(user?.goalInUse || "");
  const activeGoal = goals.find((goal) => getGoalId(goal) === activeGoalId);
  return getGoalId(activeGoal || goals[0]);
}

async function isGoalLockedForPlan(req, goal) {
  if (isAdmin(req) || featureAccessService.isPremiumUser(req.user)) {
    return false;
  }

  // MVP-trainers D10/F14: un objetivo asignado por el nutricionista nunca se
  // bloquea mientras la relación "nutrition" siga activa — ni cuenta contra
  // el límite propio del cliente para bloquear los DEMÁS objetivos.
  const { hasActiveNutrition, relevantGoals } = await nutritionalGoalService.getGoalsForLockCheck(req.user.id);
  if (goal.assignedByTrainerId && hasActiveNutrition) return false;

  const limit = featureAccessService.getLimits(req.user).nutritionalGoals;
  if (relevantGoals.length <= limit) return false;

  const unlockedGoalId = getFreeUnlockedGoalId(req.user, relevantGoals);
  return getGoalId(goal) !== unlockedGoalId;
}

async function syncActiveGoalAfterDelete(userId, deletedGoalId) {
  const user = await userSchema.findById(userId).select("goalInUse");
  const isDeletedGoalActive =
    String(user?.goalInUse || "") === String(deletedGoalId || "");

  if (!isDeletedGoalActive) {
    return user?.goalInUse || null;
  }

  const fallbackGoal = await nutritionalGoalService.getLatestByUserId(userId);
  if (fallbackGoal?._id) {
    await userSchema.findByIdAndUpdate(userId, {
      $set: { goalInUse: fallbackGoal._id },
    });
    return fallbackGoal._id;
  }

  await userSchema.findByIdAndUpdate(userId, { $unset: { goalInUse: 1 } });
  return null;
}

const controller = {
  async create(req, res) {
    const used = await nutritionalGoalService.countEffectiveUserGoals(req.user.id);
    const limits = featureAccessService.getLimits(req.user);
    const limit = limits.nutritionalGoals;

    if (!featureAccessService.canCreateNutritionalGoal(req.user, used)) {
      return res.status(403).send({
        message: "Has alcanzado el limite de objetivos nutricionales",
        code: "NUTRITIONAL_GOALS_LIMIT_REACHED",
        limit,
        used,
        isPremium: featureAccessService.isPremiumUser(req.user),
      });
    }

    const goal = await nutritionalGoalService.create({
      userId: req.user.id,
      name: req.body.name || "Default",
      kcalTotal: req.body.kcalTotal || 0,
      proteinsGTotal: req.body.proteinsGTotal || 0,
      carbohydratesGTotal: req.body.carbohydratesGTotal || 0,
      fatGTotal: req.body.fatGTotal || 0,
    });

    if (!req.user.goalInUse) {
      await userSchema.findByIdAndUpdate(req.user.id, {
        $set: { goalInUse: goal._id },
      });
    }

    return res.send(goal);
  },

  async getById(req, res) {
    const goal = await nutritionalGoalService.getById(req.params.id);
    if (!goal) return res.sendStatus(404);
    if (!canAccessGoal(req, goal)) return res.sendStatus(404);
    if (await isGoalLockedForPlan(req, goal)) return sendLockedGoal(res);
    return res.send(goal);
  },

  async getAllByUserId(req, res) {
    const goals = await nutritionalGoalService.getByUserId(req.user.id);
    return res.send(goals);
  },

  async update(req, res) {
    const currentGoal = await nutritionalGoalService.getById(req.params.id);
    if (!currentGoal) return res.sendStatus(404);
    if (!canAccessGoal(req, currentGoal)) return res.sendStatus(404);
    if (!isAdmin(req) && currentGoal.assignedByTrainerId) return sendTrainerAssignedGoal(res);
    if (await isGoalLockedForPlan(req, currentGoal)) return sendLockedGoal(res);

    const goal = isAdmin(req)
      ? await nutritionalGoalService.update(req.params.id, sanitizeGoalInput(req.body))
      : await nutritionalGoalService.updateByUserId(
          req.params.id,
          req.user.id,
          sanitizeGoalInput(req.body),
        );

    if (!goal) return res.sendStatus(404);
    return res.send(goal);
  },

  async remove(req, res) {
    const currentGoal = await nutritionalGoalService.getById(req.params.id);
    if (!currentGoal) return res.sendStatus(404);
    if (!canAccessGoal(req, currentGoal)) return res.sendStatus(404);
    if (!isAdmin(req) && currentGoal.assignedByTrainerId) return sendTrainerAssignedGoal(res);

    const ownerId = currentGoal.userId;
    const goalCount = await nutritionalGoalService.countByUserId(ownerId);
    if (goalCount <= 1) {
      return res.status(409).send({
        message: "Debes tener al menos un objetivo nutricional",
        code: "NUTRITIONAL_GOALS_MINIMUM_ONE",
      });
    }

    const deletedGoal = isAdmin(req)
      ? await nutritionalGoalService.remove(req.params.id)
      : await nutritionalGoalService.removeByUserId(req.params.id, req.user.id);

    if (!deletedGoal) return res.sendStatus(404);

    const goalInUse = await syncActiveGoalAfterDelete(ownerId, currentGoal._id);

    return res.send({ goalInUse });
  },

  async activate(req, res) {
    const goal = await nutritionalGoalService.getById(req.params.id);
    if (!goal) return res.sendStatus(404);
    if (!canAccessGoal(req, goal)) return res.sendStatus(404);
    if (await isGoalLockedForPlan(req, goal)) return sendLockedGoal(res);

    await userSchema.findByIdAndUpdate(goal.userId, {
      $set: { goalInUse: goal._id },
    });

    return res.send({ goalInUse: goal._id, goal });
  },
};

module.exports = controller;
