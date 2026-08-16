const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./plan-assignment-controller");
// Funcionalidad 7 (objetivos nutricionales) vive en su propio componente,
// pero comparte prefijo /trainer/clients/:clientId — se monta aquí en vez de
// crear un fichero de rutas de una sola línea.
const nutritionalGoalController = require("../nutritionalGoals/nutritional-goal-controller");

const router = express.Router();

router.postAsync(
  "/clients/:clientId/diet-plan",
  auth(["trainer"]),
  controller.applyToClient
);
router.getAsync(
  "/clients/:clientId/diet-plan",
  auth(["trainer"]),
  controller.getCurrent
);

router.postAsync(
  "/clients/:clientId/nutritional-goal",
  auth(["trainer"]),
  nutritionalGoalController.assignByTrainer
);

module.exports = router;
