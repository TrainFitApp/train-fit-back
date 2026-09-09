const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./diet-template-controller");
const suggestionController = require("./diet-suggestion-controller");

const router = express.Router();

// --- Biblioteca de plantillas propias del profesional ---
router.postAsync("/trainer/diet-templates", auth(["trainer"]), controller.createTemplate);
router.getAsync("/trainer/diet-templates", auth(["trainer"]), controller.listTemplates);
router.putAsync("/trainer/diet-templates/:id", auth(["trainer"]), controller.updateTemplate);
router.deleteAsync("/trainer/diet-templates/:id", auth(["trainer"]), controller.deleteTemplate);

// --- Sugerencias de dieta (cajón lateral al empezar una fase) ---
router.postAsync(
  "/trainer/clients/:clientId/diet-suggestions",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  suggestionController.suggest
);

// Aplicar una plantilla a un cliente concreto vive ahora en
// planAssignments/plan-assignment-routes.js (Fase 8) — este router ya no
// registra esa ruta legacy (leía customProducts/customRecipes sueltos, shape
// sustituido por alternatives[] en la Fase 9).

module.exports = router;
