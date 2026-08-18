const FREE_LIMITS = {
  routines: 1,
  microcyclesPerRoutine: 4,
  customExercises: 2,
  recipes: 2,
  nutritionalGoals: 1,
};

const PREMIUM_LIMITS = {
  routines: Number.MAX_SAFE_INTEGER,
  microcyclesPerRoutine: 50,
  customExercises: Number.MAX_SAFE_INTEGER,
  recipes: Number.MAX_SAFE_INTEGER,
  nutritionalGoals: 10,
};

// Revalida contra expiresAt en vez de confiar ciegamente en el booleano cacheado:
// si el webhook de EXPIRATION nunca llega, esto sigue degradando al usuario a
// FREE en cuanto pase la fecha, sin depender de ningún evento externo.
function isEffectivelyEntitled(premium) {
  if (!premium?.entitled) return false;
  if (!premium.expiresAt) return true;
  return new Date(premium.expiresAt).getTime() > Date.now();
}

function isPremiumUser(user) {
  return isEffectivelyEntitled(user?.premium);
}

function getLimits(user) {
  return isPremiumUser(user) ? PREMIUM_LIMITS : FREE_LIMITS;
}

function canCreateRoutine(user, routineCount) {
  const limits = getLimits(user);
  return routineCount < limits.routines;
}

function canAddMicrocycle(user, microcycleCount) {
  const limits = getLimits(user);
  return microcycleCount < limits.microcyclesPerRoutine;
}

function canCreateExercise(user, exerciseCount) {
  const limits = getLimits(user);
  return exerciseCount < limits.customExercises;
}

function canCreateRecipe(user, recipeCount) {
  const limits = getLimits(user);
  return recipeCount < limits.recipes;
}

function canCreateNutritionalGoal(user, nutritionalGoalCount) {
  const limits = getLimits(user);
  return nutritionalGoalCount < limits.nutritionalGoals;
}

function canSeeAds(user) {
  return !isPremiumUser(user);
}

function getRemaining(limit, used) {
  if (limit === Number.MAX_SAFE_INTEGER) return null;
  return Math.max(limit - used, 0);
}

function normalizePlan(plan) {
  if (typeof plan !== "string") return null;
  const normalized = plan.trim().toLowerCase();
  if (normalized === "monthly") return "monthly";
  if (normalized === "annual") return "annual";
  if (normalized === "manual") return "manual";
  return null;
}

function buildEntitlements(user, usage) {
  const limits = getLimits(user);
  const normalizedPlan = normalizePlan(user?.premium?.plan);
  const normalizedUsage = {
    routines: usage.routines || 0,
    customExercises: usage.customExercises || 0,
    recipes: usage.recipes || 0,
    nutritionalGoals: usage.nutritionalGoals || 0,
  };

  return {
    isPremium: isPremiumUser(user),
    source: user?.premium?.source || "legacy",
    plan: normalizedPlan,
    expiresAt: user?.premium?.expiresAt || null,
    limits: {
      routines: limits.routines === Number.MAX_SAFE_INTEGER ? null : limits.routines,
      microcyclesPerRoutine: limits.microcyclesPerRoutine,
      customExercises:
        limits.customExercises === Number.MAX_SAFE_INTEGER
          ? null
          : limits.customExercises,
      recipes: limits.recipes === Number.MAX_SAFE_INTEGER ? null : limits.recipes,
      nutritionalGoals:
        limits.nutritionalGoals === Number.MAX_SAFE_INTEGER
          ? null
          : limits.nutritionalGoals,
    },
    usage: {
      routines: normalizedUsage.routines,
      customExercises: normalizedUsage.customExercises,
      recipes: normalizedUsage.recipes,
      nutritionalGoals: normalizedUsage.nutritionalGoals,
    },
    remaining: {
      routines: getRemaining(limits.routines, normalizedUsage.routines),
      customExercises: getRemaining(
        limits.customExercises,
        normalizedUsage.customExercises,
      ),
      recipes: getRemaining(limits.recipes, normalizedUsage.recipes),
      nutritionalGoals: getRemaining(
        limits.nutritionalGoals,
        normalizedUsage.nutritionalGoals,
      ),
    },
    adsEnabled: canSeeAds(user),
  };
}

module.exports = {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  isEffectivelyEntitled,
  isPremiumUser,
  getLimits,
  canCreateRoutine,
  canAddMicrocycle,
  canCreateExercise,
  canCreateRecipe,
  canCreateNutritionalGoal,
  canSeeAds,
  buildEntitlements,
};
