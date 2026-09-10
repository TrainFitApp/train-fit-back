const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./weight-plan-controller");
const { requireActiveClient } = require("../trainerClients/require-active-client");

const router = express.Router();

// --- Lado profesional ---
router.getAsync(
  "/clients/:clientId/weight-plan",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getForClient
);
router.putAsync(
  "/clients/:clientId/weight-plan",
  auth(["trainer"]),
  requireActiveClient(),
  controller.upsertForClient
);
router.deleteAsync(
  "/clients/:clientId/weight-plan",
  auth(["trainer"]),
  requireActiveClient(),
  controller.removeForClient
);

// --- Lado cliente ---
router.getAsync("/weight-plans/mine", auth(["user", "admin"]), controller.listMine);

module.exports = router;
