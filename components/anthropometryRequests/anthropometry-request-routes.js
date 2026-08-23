const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./anthropometry-request-controller");
const { requireActiveClient } = require("../trainerClients/require-active-client");

const router = express.Router();

// --- Lado profesional: petición de medidas de un cliente concreto ---
router.getAsync(
  "/clients/:clientId/anthropometry-request",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getForClient
);
router.putAsync(
  "/clients/:clientId/anthropometry-request",
  auth(["trainer"]),
  requireActiveClient(),
  controller.upsertForClient
);
router.deleteAsync(
  "/clients/:clientId/anthropometry-request",
  auth(["trainer"]),
  requireActiveClient(),
  controller.cancelForClient
);

// --- Lado cliente ---
router.getAsync("/anthropometry-requests/mine", auth(["user", "admin"]), controller.listMine);

module.exports = router;
