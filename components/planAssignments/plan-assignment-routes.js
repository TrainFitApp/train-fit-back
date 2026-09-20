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
// Editor de una fase/revisión ya asignada — contenido completo, nunca la plantilla
// de biblioteca de origen. Registradas DESPUÉS de /active y /history para que
// esas rutas literales no las intercepte el :planId genérico.
router.getAsync(
  "/trainer/clients/:clientId/nutrition-plans/:planId",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getPlanContent
);
router.putAsync(
  "/trainer/clients/:clientId/nutrition-plans/:planId",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.updateContent
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
  "/trainer/clients/:clientId/skipped-days",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.markSkippedDay
);
// --- Revisiones (docs/plan-revisiones.md) ---
router.getAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/revisions",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getPhaseRevisions
);
router.getAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/revisions/:number/need",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getRevisionNeed
);
router.postAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/revisions/next/scale",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.scaleNextRevision
);
router.putAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/revisions/next",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.prepareNextRevision
);
router.deleteAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/revisions/next",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.discardNextRevision
);
router.patchAsync(
  "/trainer/clients/:clientId/nutrition-phases/:phaseId/dates",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.updatePhaseDates
);
router.getAsync(
  "/trainer/clients/:clientId/diet-timeline",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getRevisionTimeline
);
router.getAsync(
  "/trainer/clients/:clientId/nutrition-history",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  controller.getNutritionHistory
);

module.exports = router;
