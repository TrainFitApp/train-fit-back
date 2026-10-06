const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./diet-phase-controller");

// Fases de dieta de un cliente, desde la app de entrenadores. Todo exige
// relación activa de nutrición con el cliente.
const router = express.Router();
const BASE = "/trainer/clients/:clientId";
const guard = [auth(["trainer"]), requireActiveClient("nutrition")];

router.postAsync(`${BASE}/diet-phases`, ...guard, controller.createPhase);
router.getAsync(`${BASE}/diet-phases`, ...guard, controller.listPhases);
// Antes que /:phaseId, para que la ruta literal no la intercepte el parámetro.
router.getAsync(`${BASE}/diet-phases/current`, ...guard, controller.getCurrent);
router.getAsync(`${BASE}/diet-phases/:phaseId`, ...guard, controller.getPhase);
router.patchAsync(`${BASE}/diet-phases/:phaseId`, ...guard, controller.updatePhase);
router.deleteAsync(`${BASE}/diet-phases/:phaseId`, ...guard, controller.cancelPhase);
router.putAsync(`${BASE}/diet-phases/:phaseId/contents/:contentId`, ...guard, controller.updateContent);

// Semanas (docs/plan-semanas.md).
router.getAsync(`${BASE}/diet-phases/:phaseId/weeks`, ...guard, controller.getPhaseWeeks);
router.getAsync(`${BASE}/diet-phases/:phaseId/weeks/:number/need`, ...guard, controller.getWeekNeed);
router.postAsync(`${BASE}/diet-phases/:phaseId/weeks/next/scale`, ...guard, controller.scaleNextWeek);
router.putAsync(`${BASE}/diet-phases/:phaseId/weeks/next`, ...guard, controller.prepareNextWeek);
router.deleteAsync(`${BASE}/diet-phases/:phaseId/weeks/next`, ...guard, controller.discardNextWeek);

router.getAsync(`${BASE}/diet-timeline`, ...guard, controller.getDietTimeline);
router.getAsync(`${BASE}/nutrition-history`, ...guard, controller.getNutritionHistory);
router.postAsync(`${BASE}/skipped-days`, ...guard, controller.skipDay);

module.exports = router;
