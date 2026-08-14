const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./workout-template-controller");

const router = express.Router();

// --- Biblioteca de plantillas propias del profesional ---
router.postAsync("/trainer/workout-templates", auth(["trainer"]), controller.createTemplate);
router.getAsync("/trainer/workout-templates", auth(["trainer"]), controller.listTemplates);
router.putAsync("/trainer/workout-templates/:id", auth(["trainer"]), controller.updateTemplate);
router.deleteAsync("/trainer/workout-templates/:id", auth(["trainer"]), controller.deleteTemplate);

// Guardar un Workout real ya construido (en mesocycle.page.ts) como plantilla
// reutilizable — cierra el círculo "constrúyelo una vez, reutilízalo". La
// ruta de "aplicar plantilla a un split de un cliente" vive en
// trainerClients/trainer-client-routes.js (lleva :clientId, necesita
// requireActiveClient, misma comprobación única que el resto de rutas de ese
// router).
router.postAsync(
  "/trainer/workouts/:workoutId/save-as-template",
  auth(["trainer"]),
  controller.saveWorkoutAsTemplate
);

module.exports = router;
