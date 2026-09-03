const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./routine-assignment-controller");

const router = express.Router();

router.postAsync(
  "/trainer/clients/:clientId/tables/:tableId/apply",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.applyRoutine
);
router.getAsync(
  "/trainer/clients/:clientId/routine-assignments/active",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.getActive
);
router.getAsync(
  "/trainer/clients/:clientId/routine-assignments/history",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.getHistory
);
router.getAsync(
  "/trainer/clients/:clientId/routine-assignments/active/schedule",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.getActiveSchedule
);
router.deleteAsync(
  "/trainer/clients/:clientId/routine-assignments/:assignmentId",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.cancelPhase
);
router.patchAsync(
  "/trainer/clients/:clientId/routine-assignments/:assignmentId",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.reschedulePhase
);

module.exports = router;
