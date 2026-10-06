const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./diet-template-controller");
const suggestionController = require("./diet-suggestion-controller");

const router = express.Router();

// --- Biblioteca de plantillas propias del profesional ---
// admin en la lista: puede crear/editar plantillas de fábrica (verified).
// El controller distingue admin vs trainer para ese campo concreto.
router.postAsync("/trainer/diet-templates", auth(["trainer", "admin"]), controller.createTemplate);
router.getAsync("/trainer/diet-templates", auth(["trainer", "admin"]), controller.listTemplates);
router.getAsync("/trainer/diet-templates/:id", auth(["trainer", "admin"]), controller.getTemplate);
router.putAsync("/trainer/diet-templates/:id", auth(["trainer", "admin"]), controller.updateTemplate);
router.deleteAsync("/trainer/diet-templates/:id", auth(["trainer", "admin"]), controller.deleteTemplate);

// --- Sugerencias de dieta (cajón lateral al empezar una fase) ---
router.postAsync(
  "/trainer/clients/:clientId/diet-suggestions",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  suggestionController.suggest
);

// Aplicar una plantilla a un cliente es crear una fase: dietPhases/diet-phase-routes.js.

module.exports = router;
