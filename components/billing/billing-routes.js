const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./billing-controller");

const router = express.Router();

router.postAsync("/customer/link", auth(["admin", "user"]), controller.linkCustomer);
router.getAsync("/entitlements/me", auth(["admin", "user"]), controller.getEntitlements);
router.postAsync("/restore", auth(["admin", "user"]), controller.restore);
router.postAsync("/webhooks/revenuecat", controller.revenueCatWebhook);

module.exports = router;
