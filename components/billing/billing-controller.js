const featureAccessService = require("./feature-access-service");
const billingService = require("./billing-service");
const exerciseModel = require("../exercises/exercise-model");
const recipeModel = require("../recipes/recipe-model");
const userSchema = require("../users/schema");

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

    if (customerInfo) {
      await billingService.syncFromCustomerInfo(user, customerInfo);
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

    const result = await billingService.processWebhook(req.body);
    return res.send(result);
  },
};
