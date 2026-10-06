const nutritionalGoalService = require("./nutritional-goal-service");
const featureAccess = require("../billing/feature-access");

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
  if (isAdmin(req) || featureAccess.isPremiumUser(req.user)) {
    return false;
  }

  const goals = await nutritionalGoalService.getByUserId(req.user.id);
  const limit = featureAccess.getLimits(req.user).nutritionalGoals;
  if (goals.length <= limit) return false;

  const unlockedGoalId = getFreeUnlockedGoalId(req.user, goals);
  return getGoalId(goal) !== unlockedGoalId;
}

const controller = {
  async create(req, res) {
    const used = await nutritionalGoalService.countByUserId(req.user.id);
    const limits = featureAccess.getLimits(req.user);
    const limit = limits.nutritionalGoals;

    if (!featureAccess.canCreateNutritionalGoal(req.user, used)) {
      return res.status(403).send({
        message: "Has alcanzado el limite de objetivos nutricionales",
        code: "NUTRITIONAL_GOALS_LIMIT_REACHED",
        limit,
        used,
        isPremium: featureAccess.isPremiumUser(req.user),
      });
    }

    const goal = await nutritionalGoalService.createForUser(req.user.id, {
      name: req.body.name || "Default",
      kcalTotal: req.body.kcalTotal || 0,
      proteinsGTotal: req.body.proteinsGTotal || 0,
      carbohydratesGTotal: req.body.carbohydratesGTotal || 0,
      fatGTotal: req.body.fatGTotal || 0,
    });
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

    const goalInUse = await nutritionalGoalService.removeGoal(currentGoal, isAdmin(req) ? null : req.user.id);
    if (goalInUse === undefined) return res.sendStatus(404);
    return res.send({ goalInUse });
  },

  async activate(req, res) {
    const goal = await nutritionalGoalService.getById(req.params.id);
    if (!goal) return res.sendStatus(404);
    if (!canAccessGoal(req, goal)) return res.sendStatus(404);
    if (await isGoalLockedForPlan(req, goal)) return sendLockedGoal(res);

    await nutritionalGoalService.activate(goal);
    return res.send({ goalInUse: goal._id, goal });
  },
};

module.exports = controller;
