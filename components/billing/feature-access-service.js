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

// isExempt: true si la rutina concreta tiene assignedByTrainerId Y el cliente
// tiene ahora relación "training" activa (MVP-trainers D10/F14) — el caller
// (split-controller.js) calcula esto, no depende solo de isPremiumUser.
function canAddMicrocycle(user, microcycleCount, isExempt = false) {
  const limits = isPremiumUser(user) || isExempt ? PREMIUM_LIMITS : FREE_LIMITS;
  return microcycleCount < limits.microcyclesPerRoutine;
}

// Ejercicios propios de ENTRENADOR — sin límite (F? MASTER_BACKLOG). No usa
// premium.entitled (el de CONSUMIDOR): un entrenador crea ejercicios para su
// trabajo profesional, no como cliente. professionalPremium tampoco aplica
// aquí a propósito (decisión de producto: sin gate, no un lugar donde
// monetizar esto todavía).
function canCreateExercise(user, exerciseCount) {
  if (user?.roles?.includes("trainer")) return true;
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

// hasActiveTrainerRelation: MVP-trainers D10/F14 — un cliente FREE con
// relación activa (cualquier scope) con un profesional no ve anuncios,
// mientras dure la relación (sin periodo de gracia al terminar).
function canSeeAds(user, hasActiveTrainerRelation = false) {
  return !isPremiumUser(user) && !hasActiveTrainerRelation;
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

function buildEntitlements(user, usage, hasActiveTrainerRelation = false) {
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
    adsEnabled: canSeeAds(user, hasActiveTrainerRelation),
  };
}

// MVP-trainers F02 — límites de clientes del PROFESIONAL (no confundir con
// los límites de arriba, que son del CLIENTE). Independiente de isPremiumUser
// (que lee User.premium, el entitlement de consumidor) — lee
// User.professionalPremium en su lugar.
const TRAINER_CLIENT_LIMITS = {
  free: 3,
  trainer_pro: 15,
  trainer_unlimited: Number.MAX_SAFE_INTEGER,
};

function isPremiumTrainer(user) {
  return Boolean(user?.professionalPremium?.entitled);
}

function getTrainerLimits(user) {
  if (!isPremiumTrainer(user)) return { clients: TRAINER_CLIENT_LIMITS.free, tier: "free" };
  const tier = user?.professionalPremium?.tier;
  if (tier === "trainer_unlimited") {
    return { clients: TRAINER_CLIENT_LIMITS.trainer_unlimited, tier };
  }
  // Cualquier entitlement de profesional activo sin tier UNLIMITED reconocido
  // se trata como PRO — evita bloquear al profesional por un valor de tier
  // inesperado mientras sí paga.
  return { clients: TRAINER_CLIENT_LIMITS.trainer_pro, tier: tier || "trainer_pro" };
}

function canInviteClient(user, activeClientCount) {
  const { clients } = getTrainerLimits(user);
  return activeClientCount < clients;
}

function buildTrainerEntitlements(user, activeClientCount) {
  const { clients, tier } = getTrainerLimits(user);
  return {
    isPremium: isPremiumTrainer(user),
    tier,
    plan: user?.professionalPremium?.plan || null,
    expiresAt: user?.professionalPremium?.expiresAt || null,
    limits: { clients: clients === Number.MAX_SAFE_INTEGER ? null : clients },
    usage: { clients: activeClientCount || 0 },
    remaining: { clients: getRemaining(clients, activeClientCount || 0) },
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
  isPremiumTrainer,
  getTrainerLimits,
  canInviteClient,
  buildTrainerEntitlements,
};
