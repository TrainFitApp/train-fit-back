const FREE_LIMITS = {
  routines: 1,
  microcyclesPerRoutine: 4,
  customExercises: 2,
  recipes: 2,
  nutritionalGoals: 1,
};

const PREMIUM_LIMITS = {
  routines: Number.MAX_SAFE_INTEGER,
  microcyclesPerRoutine: 21,
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

// Funcionalidad 16 — monetización B2B del trainer, por capacidad de
// clientes gestionables. Tres tiers, sin integración de pago real todavía
// (placeholder consciente para el MVP): el límite ya es real y bloquea de
// verdad (usado en trainer-client-service.js#invite), solo falta cobrar.
const TRAINER_TIER_LIMITS = {
  free: { maxClients: 3 },
  trainer_pro: { maxClients: 20 },
  trainer_unlimited: { maxClients: Number.MAX_SAFE_INTEGER },
};

function isTrainerEntitled(professionalPremium) {
  if (!professionalPremium?.entitled) return false;
  if (!professionalPremium.expiresAt) return true;
  return new Date(professionalPremium.expiresAt).getTime() > Date.now();
}

function getTrainerTier(user) {
  if (!isTrainerEntitled(user?.professionalPremium)) return "free";
  const tier = user?.professionalPremium?.tier;
  return TRAINER_TIER_LIMITS[tier] ? tier : "free";
}

function getTrainerLimits(user) {
  return TRAINER_TIER_LIMITS[getTrainerTier(user)];
}

// Cuenta clientes ÚNICOS con relación no-terminal (cualquier scope) — un
// mismo cliente con training+nutrition (2 TrainerClient, funcionalidad 2)
// cuenta una sola vez contra el límite.
function canInviteClient(user, activeUniqueClientCount) {
  const limits = getTrainerLimits(user);
  return activeUniqueClientCount < limits.maxClients;
}

function buildTrainerEntitlements(user, activeUniqueClientCount) {
  const tier = getTrainerTier(user);
  const limits = TRAINER_TIER_LIMITS[tier];
  const maxClients = limits.maxClients === Number.MAX_SAFE_INTEGER ? null : limits.maxClients;

  return {
    tier,
    isPaid: tier !== "free",
    source: user?.professionalPremium?.source || null,
    expiresAt: user?.professionalPremium?.expiresAt || null,
    maxClients,
    activeClients: activeUniqueClientCount,
    remainingClients: maxClients === null ? null : Math.max(maxClients - activeUniqueClientCount, 0),
  };
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
  TRAINER_TIER_LIMITS,
  isTrainerEntitled,
  getTrainerTier,
  getTrainerLimits,
  canInviteClient,
  buildTrainerEntitlements,
};
