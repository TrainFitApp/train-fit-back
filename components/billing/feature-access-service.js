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

// hasActiveTrainerRelation: MVP-trainers D10/F14 — un cliente FREE con
// relación activa (cualquier scope) con un profesional no ve anuncios,
// mientras dure la relación (sin periodo de gracia al terminar).
function canSeeAds(user, hasActiveTrainerRelation = false) {
  return !isPremiumUser(user) && !hasActiveTrainerRelation;
}

// Fotos y vídeos (docs/plan-medidas-multimedia.md, decisiones 1 y 7): suben
// gratis los entrenadores, los clientes premium y los clientes con relación
// activa con un profesional (cualquier scope, mientras dure) — misma
// exención que canSeeAds y canAddMicrocycle.
function canUploadMedia(user, hasActiveTrainerRelation = false) {
  if (!user) return false;
  if (Array.isArray(user.roles) && user.roles.includes("trainer")) return true;
  return isPremiumUser(user) || Boolean(hasActiveTrainerRelation);
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

// Plan del PROFESIONAL (no confundir con los límites de arriba, que son del CLIENTE): lo proyecta
// la facturación de Trainers en User.professionalPremium (plazas contratadas, plan y periodicidad).
// Sin proyección vigente, Free con sus plazas gratis. Solo vale una proyección del mismo entorno
// que la clave de Stripe del servidor: una compra de prueba nunca da plazas en real.
function trainerPlan(user) {
  const catalog = require("../../.build/trainer-billing/catalog");
  const premium = user?.professionalPremium;
  const mode = catalog.billingModeFromKey(process.env.STRIPE_KEY);
  const valid = Boolean(premium?.entitled && premium.expiresAt && new Date(premium.expiresAt).getTime() > Date.now() &&
    Number.isSafeInteger(premium.seats) && premium.seats > 0 && (!mode || premium.stripeMode === mode));
  return valid
    ? { paid: true, tier: premium.tier, interval: premium.interval || null, seats: premium.seats, expiresAt: premium.expiresAt }
    : { paid: false, tier: "free", interval: null, seats: catalog.FREE_SEATS, expiresAt: null };
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
  canUploadMedia,
  buildEntitlements,
  trainerPlan,
};
