const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./billing-controller");

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
router.postAsync("/webhooks/revenuecat", controller.revenueCatWebhook);

module.exports = router;
