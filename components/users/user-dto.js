const featureAccess = require("../billing/feature-access");
const billingService = require("../billing/billing-service");

// Cualquier respuesta que serialice un User pasa por aquí (login, refresh de
// sesión, perfil, panel admin...). Es el único punto que garantiza que
// "premium.entitled" nunca salga como true una vez pasada expiresAt, aunque
// el webhook de EXPIRATION de RevenueCat nunca haya llegado al backend.
function resolvePremium(resource) {
  const premium = resource?.premium;
  if (!premium) return premium;

  const effectiveEntitled = featureAccess.isEffectivelyEntitled(premium);
  if (premium.entitled && !effectiveEntitled) {
    void billingService.reconcileExpiredPremiumIfNeeded(resource);
  }

  return {
    entitled: effectiveEntitled,
    plan: premium.plan,
    expiresAt: premium.expiresAt,
    source: premium.source,
    lastSyncAt: premium.lastSyncAt,
  };
}

// Lo que el usuario no guarda tal cual lo calcula users/user-service.js#view y llega
// aquí: `weight`, el último peso de sus medidas, y `routine`, la rutina y la
// sesión que tiene en uso (routineAssignments/routine-in-use.js). Sin ellos
// no se sirven: nunca salen los punteros guardados a pelo.
const single = async (resource, authUser, { weight, routine } = {}) => ({
  _id: resource._id,
  name: resource.name,
  lastname: resource.lastname,
  email: resource.email,
  roles: resource.roles,
  activity: resource.activity,
  sex: resource.sex,
  objetive: resource.objetive,
  steps: resource.steps,
  training: resource.training,
  height: resource.height,
  ...(weight !== undefined ? { weight } : {}),
  goalInUse: resource.goalInUse,
  ...(routine ? { tableInUse: routine.tableInUse, workoutInUse: routine.workoutInUse } : {}),
  dietPinnedNote: resource.dietPinnedNote,
  favorites: {
    products: resource.favorites?.products || [],
    recipes: resource.favorites?.recipes || [],
    exercises: resource.favorites?.exercises || [],
  },
  birth: resource.birth,
  // `hash` (código de activación pendiente) no sale nunca: ninguna pantalla
  // lo necesita y es justo el secreto que activa la cuenta.
  personalAds: resource.personalAds,
  lastLogin: resource.lastLogin,
  premium: resolvePremium(resource),
  theme: resource.theme,
  provider: resource.provider,
});

const multiple = (resources, authUser) =>
  resources.map((resource) => single(resource, authUser));

module.exports = {
  single,
  multiple,
  resolvePremium,
};
