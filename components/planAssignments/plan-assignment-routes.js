const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./plan-assignment-controller");

const router = express.Router();

router.postAsync(
  "/trainer/clients/:clientId/nutrition-plans/:planId/apply",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.applyPlan
);
router.getAsync(
  "/trainer/clients/:clientId/nutrition-plans/active",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getActive
);
router.getAsync(
  "/trainer/clients/:clientId/nutrition-plans/history",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getHistory
);
router.postAsync(
  "/trainer/clients/:clientId/diet-exceptions",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.createException
);
router.getAsync(
  "/trainer/clients/:clientId/diet-exceptions",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.listExceptions
);

module.exports = router;
