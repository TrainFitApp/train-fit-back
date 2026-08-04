const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./diet-template-controller");

const router = express.Router();

// --- Biblioteca de plantillas propias del profesional ---
router.postAsync("/trainer/diet-templates", auth(["trainer"]), controller.createTemplate);
router.getAsync("/trainer/diet-templates", auth(["trainer"]), controller.listTemplates);
router.putAsync("/trainer/diet-templates/:id", auth(["trainer"]), controller.updateTemplate);
router.deleteAsync("/trainer/diet-templates/:id", auth(["trainer"]), controller.deleteTemplate);

// --- Aplicar una plantilla a un cliente concreto ---
router.postAsync(
  "/trainer/clients/:clientId/diet-templates/:templateId/apply",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.applyToClient
);

module.exports = router;
