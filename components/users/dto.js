const featureAccessService = require("../billing/feature-access-service");
const billingService = require("../billing/billing-service");

// Cualquier respuesta que serialice un User pasa por aquí (login, refresh de
// sesión, perfil, panel admin...). Es el único punto que garantiza que
// "premium.entitled" nunca salga como true una vez pasada expiresAt, aunque
// el webhook de EXPIRATION de RevenueCat nunca haya llegado al backend.
function resolvePremium(resource) {
  const premium = resource?.premium;
  if (!premium) return premium;

  const effectiveEntitled = featureAccessService.isEffectivelyEntitled(premium);
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

const single = async (resource, authUser) => ({
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
  weight: resource.weight,
  goalInUse: resource.goalInUse,
  workoutInUse: resource.workoutInUse,
  dietInUse: resource.dietInUse,
  tableInUse: resource.tableInUse,
  tables: resource.tables,
  archivedProducts: resource.archivedProducts,
  archivedExercises: resource.archivedExercises,
  archivedRecipes: resource.archivedRecipes,
  birth: resource.birth,
  hash: resource.hash,
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
};
