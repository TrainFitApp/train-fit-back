const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./checkin-controller");
const { requireActiveClient } = require("../trainerClients/require-active-client");

const router = express.Router();

// --- Lado profesional: plantillas maestras ---
router.getAsync("/checkin-templates", auth(["trainer"]), controller.listDefinitions);
router.postAsync("/checkin-templates", auth(["trainer"]), controller.createDefinition);
router.putAsync("/checkin-templates/:id", auth(["trainer"]), controller.updateDefinition);
router.deleteAsync("/checkin-templates/:id", auth(["trainer"]), controller.deleteDefinition);
router.postAsync("/checkin-templates/:id/apply", auth(["trainer"]), controller.applyDefinition);

// --- Lado profesional: configuración/histórico de un cliente concreto ---
router.getAsync(
  "/clients/:clientId/checkin-config",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientCheckinConfig
);
router.getAsync(
  "/clients/:clientId/checkin-responses",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientCheckinResponses
);

// --- Lado cliente ---
router.getAsync("/checkins/mine", auth(["user", "admin"]), controller.listMine);
// coach-tab FASE2 — "formularios completados", histórico agregado del cliente.
router.getAsync("/checkins/mine/history", auth(["user", "admin"]), controller.listMyHistory);
router.postAsync("/checkins/:trainerId/respond", auth(["user", "admin"]), controller.respond);

module.exports = router;
