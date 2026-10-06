const billingService = require("./billing-service");
const entitlementService = require("./entitlement-service");
const userService = require("../users/user-service");

function disableCache(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

module.exports = {
  async linkCustomer(req, res) {
    const user = req.user;
    // El app user id de RevenueCat es siempre el _id del usuario: el que
    // mande el cliente se ignora (ver billing-service#linkCustomer).
    const linkedCustomer = await billingService.linkCustomer(user);
    return res.send({
      linked: Boolean(linkedCustomer),
      appUserId: linkedCustomer?.appUserId || user?._id?.toString() || null,
    });
  },

  async getEntitlements(req, res) {
    disableCache(res);
    return res.send(await entitlementService.forUser(req.user));
  },

  async restore(req, res) {
    const rawPlan = req.body?.plan || null;
    return res.send(
      await entitlementService.restore(req.user, {
        customerInfo: req.body?.customerInfo || null,
        explicitPlan: rawPlan === "monthly" || rawPlan === "annual" ? rawPlan : null,
      }),
    );
  },

  async revenueCatWebhook(req, res) {
    const isAuthorized = billingService.validateWebhookAuth(req);
    if (!isAuthorized) {
      return res.status(401).send({ message: "Unauthorized webhook" });
    }

    return res.send(await billingService.processWebhook(req.body));
  },

  // Premium manual desde management (promocionales de RevenueCat).
  async grantPremium(req, res) {
    const user = await billingService.grantAdminPremium(req.body?.userId, req.body?.duration);
    return res.send(await userService.view(user, req.user));
  },

  async extendPremium(req, res) {
    const user = await billingService.extendAdminPremium(req.body?.userId, req.body?.duration);
    return res.send(await userService.view(user, req.user));
  },

  async revokePremium(req, res) {
    const user = await billingService.revokeAdminPremium(req.body?.userId);
    return res.send(await userService.view(user, req.user));
  },

  async getSubscriptionStatus(req, res) {
    return res.send(await billingService.getAdminSubscriptionStatus(req.params?.userId));
  },
};
