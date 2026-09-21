// Adaptador CommonJS del backend existente. La lógica de negocio vive en TS strict.
let runtime;
function getRuntime() {
  if (runtime) return runtime;
  const { createRuntime } = require("../../.build/trainer-billing/runtime");
  const User = require("../users/schema");
  runtime = createRuntime({
    async clientUsage(id) {
      const keys = await require("../trainerClients/trainer-client-dao").getBillableClientKeys(id);
      return keys.size;
    },
    async getUser(id) {
      const user = await User.findById(id).select("email professionalPremium").lean();
      return user ? { id: String(user._id), email: user.email, professionalPremium: user.professionalPremium } : null;
    },
    async project(account, value) {
      // Fencing: una escritura antigua nunca puede sobrescribir una proyección nueva.
      await User.updateOne({ _id: account.userId, $or: [
        { "professionalPremium.stripeRevision": { $exists: false } },
        { "professionalPremium.stripeRevision": { $lte: value.stripeRevision } },
      ] }, { $set: { professionalPremium: value } });
    },
  });
  return runtime;
}

async function getEntitlements(userId) {
  const User = require("../users/schema");
  const featureAccess = require("../billing/feature-access-service");
  const trainerClientDao = require("../trainerClients/trainer-client-dao");
  const { billingMetadata } = require("../../.build/trainer-billing/runtime");
  const user = await User.findById(userId);
  const usage = await trainerClientDao.getBillableClientKeys(userId);
  const current = getRuntime();
  const account = await current.repository.get(String(userId));
  const source = user?.professionalPremium?.source || null;
  const entitlements = featureAccess.buildTrainerEntitlements(user, usage.size);
  return { ...entitlements,
    // Plan de pago que no gestiona Stripe (RevenueCat Pro 15, Unlimited): la UI no ofrece cambios.
    legacy: Boolean(entitlements.isPremium && source !== "stripe"),
    ...billingMetadata(current.config, account, source) };
}

function sendError(res, error) {
  const { BillingError } = require("../../.build/trainer-billing/types");
  if (error instanceof BillingError) return res.status(error.status).json({ code: error.code, message: error.message });
  // Stripe/Mongo errors may carry request payloads. Never expose/log them.
  console.error("[TrainerBilling] Operation failed; retry or inspect provider dashboard.");
  return res.status(503).json({ code: "BILLING_UNAVAILABLE", message: "No se ha podido completar la operación de facturación. Inténtalo de nuevo." });
}

function handler(action) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { return res.json(await action(req)); }
    catch (error) { return sendError(res, error); }
  };
}
const controller = {
  plans: handler(() => getRuntime().service.plans()),
  entitlements: handler((req) => getEntitlements(String(req.user._id))),
  checkout: handler((req) => getRuntime().service.checkout(String(req.user._id), req.body?.tier, req.body?.interval)),
  portal: handler((req) => getRuntime().service.portal(String(req.user._id))),
  billingDetails: handler((req) => getRuntime().service.billingDetails(String(req.user._id))),
  changePreview: handler((req) => getRuntime().service.previewChange(String(req.user._id), req.body?.tier, req.body?.interval)),
  changePlan: handler(async (req) => {
    const result = await getRuntime().service.changePlan(String(req.user._id), req.body?.quoteId);
    return { ...result, entitlements: await getEntitlements(String(req.user._id)) };
  }),
  cancel: handler(async (req) => {
    await getRuntime().service.cancel(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  resume: handler(async (req) => {
    await getRuntime().service.resume(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  discardChange: handler(async (req) => {
    await getRuntime().service.discardChange(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  sync: handler(async (req) => {
    await getRuntime().service.sync(String(req.user._id), req.body?.sessionId);
    return getEntitlements(String(req.user._id));
  }),
  webhook: handler((req) => getRuntime().webhook(req.body, req.headers["stripe-signature"])),
};

module.exports = {
  controller, getRuntime, getEntitlements,
  async withClientAdmission(userId, action) {
    const current = getRuntime();
    const { requireReady } = require("../../.build/trainer-billing/config");
    requireReady(current.config);
    return current.repository.withLock(String(userId), async (account) => {
      const user = await require("../users/schema").findById(userId).select("professionalPremium").lean();
      const limit = require("../billing/feature-access-service").getTrainerLimits(user).clients;
      const target = account.change && ["processing", "scheduled", "payment_pending"].includes(account.change.status)
        ? account.change.quote.to.clientLimit : limit;
      return action(Math.min(limit, target));
    });
  },
  start: () => { if (process.env.TRAINER_BILLING_ENABLED === "1") getRuntime().startReconciliation(); },
  async prepareDeletion(id) {
    try { await getRuntime().service.prepareDeletion(String(id)); }
    catch (error) {
      const { BillingError } = require("../../.build/trainer-billing/types");
      if (error instanceof BillingError) throw error;
      throw new BillingError("BILLING_UNAVAILABLE", "No se ha podido detener la facturación. La cuenta se conserva para poder reintentarlo.", 503);
    }
  },
  assertDeletionAllowed: (ids) => getRuntime().repository.assertDeletionAllowed(ids.map(String)),
};
