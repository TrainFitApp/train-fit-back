const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./coach-protocol-controller");
const planChangeController = require("../planChanges/plan-change-controller");

const router = express.Router();

// --- Protocolos (Fase 4) ---
// Sin :clientId en la URL: un protocolo es del profesional. Al aplicarlo,
// cada clientId del body se valida por separado en el controller (ver
// applyToClients), igual que las rutas existentes de "aplicar en bloque".
router.getAsync("/protocols", auth(["trainer"]), controller.listMine);
router.postAsync("/protocols", auth(["trainer"]), controller.create);
router.postAsync("/protocols/:id/apply", auth(["trainer"]), controller.applyToClients);
router.putAsync("/protocols/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/protocols/:id", auth(["trainer"]), controller.remove);

// --- Historial de cambios de un cliente (Fase 4) ---
// Sí lleva :clientId, así que pasa por el chokepoint de autorización.
router.getAsync(
  "/clients/:clientId/changes",
  auth(["trainer"]),
  requireActiveClient(),
  planChangeController.listForClient
);

module.exports = router;
