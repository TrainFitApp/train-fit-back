const express = require("@awaitjs/express");
const controller = require("./auth-controller");
const { auth } = require("../../middleware/validateAuth");
const rateLimiter = require("../util/rate-limiter");

const router = express.Router();

router.postAsync("/login", controller.login);
router.postAsync("/refresh", controller.refresh);
router.postAsync("/logout", controller.logout);
router.getAsync("/me", auth(["admin", "user"]), controller.me);
router.postAsync("/activate", rateLimiter, controller.activate);
router.postAsync("/resend-code", rateLimiter, controller.resendActivationCode);
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

// Sesión terminada (session-service.js#sessionEnded): fuera la cookie del
// refresh antes de que errorHandler responda.
router.use((err, req, res, next) => {
  if (err?.details?.requiresRelogin) controller.clearRefreshCookie(req, res);
  next(err);
});

module.exports = router;
