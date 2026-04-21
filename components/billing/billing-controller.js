const featureAccessService = require("./feature-access-service");
const billingService = require("./billing-service");
const billingCustomerSchema = require("./billing-customer-schema");
const exerciseModel = require("../exercises/exercise-model");
const recipeModel = require("../recipes/recipe-model");
const userSchema = require("../users/schema");
const userDto = require("../users/dto");

function sendBillingAdminError(res, error) {
  const status = error?.status || error?.response?.status || 500;
  const message =
    error?.response?.data?.message ||
    error?.message ||
    "Error al gestionar premium";

  return res.status(status).send({ message });
}

module.exports = {
  async linkCustomer(req, res) {
    const user = req.user;
    const appUserId = req.body?.appUserId || null;

    const linkedCustomer = await billingService.linkCustomer(user, appUserId);
    return res.send({
      linked: Boolean(linkedCustomer),
      appUserId: linkedCustomer?.appUserId || user?._id?.toString() || null,
    });
  },

  async getEntitlements(req, res) {
    const user = req.user;

    // C2: si el usuario es premium pero sin plan registrado, derivarlo desde
    // BillingCustomer y corregirlo en BD para que los botones de cambio de plan funcionen
    if (user.premium?.entitled && !user.premium?.plan) {
      const billingCustomer = await billingCustomerSchema.findOne({ userId: user._id });
      if (billingCustomer?.productId) {
        const derivedPlan = billingService.derivePlan(billingCustomer.productId);
        if (derivedPlan !== "unknown") {
          await userSchema.findByIdAndUpdate(user._id, {
            $set: { "premium.plan": derivedPlan },
          });
          user.premium.plan = derivedPlan;
        }
      }
    }

    const routines = Array.isArray(user?.ownTables) ? user.ownTables.length : 0;
    const customExercises = await exerciseModel.countByUserId(user.id);
    const recipes = await recipeModel.countByUserId(user.id);

    return res.send(
      featureAccessService.buildEntitlements(user, {
        routines,
        customExercises,
        recipes,
      }),
    );
  },

  async restore(req, res) {
    const user = req.user;
    const customerInfo = req.body?.customerInfo || null;
    const rawPlan = req.body?.plan || null;
    const explicitPlan =
      rawPlan === "monthly" || rawPlan === "annual" ? rawPlan : null;

    if (customerInfo) {
      await billingService.syncFromCustomerInfo(user, customerInfo, explicitPlan);
    } else {
      await billingService.restoreFromRevenueCat(user, req.body?.appUserId);
    }

    const refreshedUser = await userSchema.findById(user._id);
    const routines = Array.isArray(refreshedUser?.ownTables)
      ? refreshedUser.ownTables.length
      : 0;
    const customExercises = await exerciseModel.countByUserId(user.id);
    const recipes = await recipeModel.countByUserId(user.id);

    return res.send(
      featureAccessService.buildEntitlements(refreshedUser, {
        routines,
        customExercises,
        recipes,
      }),
    );
  },

  async revenueCatWebhook(req, res) {
    const isAuthorized = billingService.validateWebhookAuth(req);
    if (!isAuthorized) {
      return res.status(401).send({ message: "Unauthorized webhook" });
    }

    // M3: try/catch explícito para controlar el log y la respuesta ante errores de MongoDB
    try {
      const result = await billingService.processWebhook(req.body);
      return res.send(result);
    } catch (error) {
      console.error("[BillingWebhook] Error inesperado en processWebhook", error);
      return res.status(500).send({ message: "Internal server error processing webhook" });
    }
  },

  async grantPremium(req, res) {
    try {
      const user = await billingService.grantAdminPremium(
        req.body?.userId,
        req.body?.duration,
      );
      return res.send(await userDto.single(user, req.user));
    } catch (error) {
      return sendBillingAdminError(res, error);
    }
  },

  async extendPremium(req, res) {
    try {
      const user = await billingService.extendAdminPremium(
        req.body?.userId,
        req.body?.duration,
      );
      return res.send(await userDto.single(user, req.user));
    } catch (error) {
      return sendBillingAdminError(res, error);
    }
  },

  async revokePremium(req, res) {
    try {
      const user = await billingService.revokeAdminPremium(req.body?.userId);
      return res.send(await userDto.single(user, req.user));
    } catch (error) {
      return sendBillingAdminError(res, error);
    }
  },

  async getSubscriptionStatus(req, res) {
    try {
      const status = await billingService.getAdminSubscriptionStatus(
        req.params?.userId,
      );
      return res.send(status);
    } catch (error) {
      return sendBillingAdminError(res, error);
    }
  },
};
