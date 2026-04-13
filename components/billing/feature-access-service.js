const FREE_LIMITS = {
  routines: 1,
  microcyclesPerRoutine: 8,
  customExercises: 3,
  recipes: 3,
};

const PREMIUM_LIMITS = {
  routines: Number.MAX_SAFE_INTEGER,
  microcyclesPerRoutine: 21,
  customExercises: Number.MAX_SAFE_INTEGER,
  recipes: Number.MAX_SAFE_INTEGER,
};

function isPremiumUser(user) {
  return Boolean(user?.premium?.entitled);
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
  return null;
}

function buildEntitlements(user, usage) {
  const limits = getLimits(user);
  const normalizedPlan = normalizePlan(user?.premium?.plan);
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
    },
    usage: {
      routines: usage.routines,
      customExercises: usage.customExercises,
      recipes: usage.recipes,
    },
    remaining: {
      routines: getRemaining(limits.routines, usage.routines),
      customExercises: getRemaining(limits.customExercises, usage.customExercises),
      recipes: getRemaining(limits.recipes, usage.recipes),
    },
    adsEnabled: canSeeAds(user),
  };
}

module.exports = {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  isPremiumUser,
  getLimits,
  canCreateRoutine,
  canAddMicrocycle,
  canCreateExercise,
  canCreateRecipe,
  canSeeAds,
  buildEntitlements,
};
