const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./billing-controller");
const trainerStripe = require("../trainerBilling/adapter").controller;

const router = express.Router();

router.postAsync("/customer/link", auth(["admin", "user"]), controller.linkCustomer);
router.getAsync("/entitlements/me", auth(["admin", "user"]), controller.getEntitlements);
router.postAsync("/restore", auth(["admin", "user"]), controller.restore);
router.postAsync("/admin/grant", auth(["admin"]), controller.grantPremium);
router.postAsync("/admin/extend", auth(["admin"]), controller.extendPremium);
router.postAsync("/admin/revoke", auth(["admin"]), controller.revokePremium);
router.getAsync(
  "/admin/status/:userId",
  auth(["admin"]),
  controller.getSubscriptionStatus,
);
router.getAsync("/trainer/entitlements/me", auth(["trainer"]), trainerStripe.entitlements);
router.getAsync("/trainer/plans", auth(["trainer"]), trainerStripe.plans);
router.postAsync("/trainer/checkout", auth(["trainer"]), trainerStripe.checkout);
router.postAsync("/trainer/portal", auth(["trainer"]), trainerStripe.portal);
router.getAsync("/trainer/billing-details", auth(["trainer"]), trainerStripe.billingDetails);
router.postAsync("/trainer/change-preview", auth(["trainer"]), trainerStripe.changePreview);
router.postAsync("/trainer/change-plan", auth(["trainer"]), trainerStripe.changePlan);
router.postAsync("/trainer/cancel", auth(["trainer"]), trainerStripe.cancel);
router.postAsync("/trainer/resume", auth(["trainer"]), trainerStripe.resume);
router.postAsync("/trainer/discard-change", auth(["trainer"]), trainerStripe.discardChange);
router.postAsync("/trainer/sync", auth(["trainer"]), trainerStripe.sync);
router.postAsync("/trainer/restore", auth(["trainer"]), controller.restoreTrainer);
router.postAsync("/webhooks/revenuecat", controller.revenueCatWebhook);

module.exports = router;
