const express = require("@awaitjs/express");
const controller = require("./auth-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

router.postAsync("/login", controller.login);
router.postAsync("/refresh", controller.refresh);
router.postAsync("/logout", controller.logout);
router.getAsync("/me", auth(["admin", "user", "trainer"]), controller.me);
router.postAsync("/activate", controller.activate);
router.postAsync("/social/google/verify", controller.verifyGoogle);
router.postAsync("/social/apple/verify", controller.verifyApple);
router.postAsync("/social/register", controller.registerSocial);
router.putAsync("/social/complete", auth(["admin", "user"]), controller.completeSocial);
router.postAsync("/impersonate", auth(["admin"]), controller.impersonate);
router.postAsync(
  "/impersonate/revert",
  auth(["admin", "user"]),
  controller.revertImpersonation
);

module.exports = router;
