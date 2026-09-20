const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./trainer-nutritional-goal-controller");

const router = express.Router();

// requireActiveClient con scope "nutrition": el objetivo nutricional solo lo
// toca quien lleva la nutrición del cliente.
router.getAsync(
  "/trainer/clients/:clientId/nutritional-goal",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getForClient
);
router.putAsync(
  "/trainer/clients/:clientId/nutritional-goal",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.updateForClient
);

module.exports = router;
