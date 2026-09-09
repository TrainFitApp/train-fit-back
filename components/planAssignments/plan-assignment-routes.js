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
router.postAsync(
  "/trainer/clients/:clientId/nutrition-plans",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.createDirect
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
// Mismo endpoint generalizado que DELETE .../routine-assignments/:assignmentId
// para entrenamiento (routine-assignment-routes.js) — quitar CUALQUIER fase,
// no solo la vigente.
router.deleteAsync(
  "/trainer/clients/:clientId/nutrition-plans/:planId",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.cancelPhase
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
