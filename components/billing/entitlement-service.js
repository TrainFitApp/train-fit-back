const billingService = require("./billing-service");
const featureAccess = require("./feature-access");
const exerciseService = require("../exercises/exercise-service");
const recipeService = require("../recipes/recipe-service");
const tableService = require("../tables/table-service");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const trainerClientService = require("../trainerClients/trainer-client-service");
const userDao = require("../users/user-dao");

// Lo que el usuario puede hacer con su plan (límites y lo que ya ha usado).

async function entitlementsOf(user) {
  const [routines, customExercises, recipes, nutritionalGoals, hasActiveTrainerRelation] = await Promise.all([
    tableService.countEffectiveUserTables(user._id),
    exerciseService.countByUserId(user._id),
    recipeService.countByUserId(user._id),
    nutritionalGoalService.countByUserId(user._id),
    trainerClientService.hasActiveTrainer(user._id),
  ]);
  return featureAccess.buildEntitlements(
    user,
    { routines, customExercises, recipes, nutritionalGoals },
    hasActiveTrainerRelation,
  );
}

module.exports = {
  // Si su premium ya caducó y el webhook no llegó, se corrige la BD ya; si es
  // premium sin plan registrado, se repara.
  async forUser(user) {
    void billingService.reconcileExpiredPremiumIfNeeded(user);
    const plan = await billingService.repairMissingPlan(user);
    if (plan && user.premium && !user.premium.plan) user.premium.plan = plan;
    return entitlementsOf(user);
  },

  // "Restaurar compras" y lo que queda tras ello.
  async restore(user, { customerInfo, explicitPlan }) {
    await billingService.restore(user, { customerInfo, explicitPlan });
    return entitlementsOf(await userDao.getUserById(user._id));
  },
};
