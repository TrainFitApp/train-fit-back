const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./workout-template-controller");

const router = express.Router();

router.postAsync(
  "/workout-templates/from-client",
  auth(["trainer"]),
  controller.createFromClient
);
router.getAsync(
  "/clients/:clientId/active-table",
  auth(["trainer"]),
  controller.getClientActiveTable
);
router.getAsync("/workout-templates", auth(["trainer"]), controller.list);
router.getAsync("/workout-templates/:id", auth(["trainer"]), controller.getById);
router.deleteAsync("/workout-templates/:id", auth(["trainer"]), controller.remove);
router.postAsync(
  "/workout-templates/:id/apply/:clientId",
  auth(["trainer"]),
  controller.applyToClient
);

// --- Builder: rutina de un cliente ---
router.postAsync(
  "/clients/:clientId/tables",
  auth(["trainer"]),
  controller.createClientTable
);
router.postAsync(
  "/clients/:clientId/tables/:tableId/splits",
  auth(["trainer"]),
  controller.addSplit
);
router.postAsync(
  "/clients/:clientId/tables/:tableId/workout-rows",
  auth(["trainer"]),
  controller.addWorkoutRow
);
router.putAsync(
  "/clients/:clientId/tables/:tableId/workout-rows/order",
  auth(["trainer"]),
  controller.reorderWorkoutRows
);
router.putAsync(
  "/clients/:clientId/tables/:tableId/workout-rows/:workoutId",
  auth(["trainer"]),
  controller.renameWorkoutRow
);
router.deleteAsync(
  "/clients/:clientId/tables/:tableId/workout-rows/:workoutId",
  auth(["trainer"]),
  controller.deleteWorkoutRow
);

// --- Builder: ejercicios/series sobre el workout de un cliente ---
router.postAsync(
  "/clients/:clientId/workouts/:workoutId/exercises",
  auth(["trainer"]),
  controller.addClientExercise
);
router.deleteAsync(
  "/clients/:clientId/workouts/:workoutId/exercises/:customExerciseId",
  auth(["trainer"]),
  controller.deleteClientExercise
);
router.postAsync(
  "/clients/:clientId/workouts/:workoutId/exercises/:customExerciseId/sets",
  auth(["trainer"]),
  controller.addClientSet
);
router.putAsync(
  "/clients/:clientId/workouts/:workoutId/exercises/:customExerciseId/sets/:setId",
  auth(["trainer"]),
  controller.updateClientSet
);
router.deleteAsync(
  "/clients/:clientId/workouts/:workoutId/exercises/:customExerciseId/sets/:setId",
  auth(["trainer"]),
  controller.deleteClientSet
);

// --- Builder: plantilla desde cero + ejercicios/series de una plantilla ---
router.postAsync(
  "/workout-templates",
  auth(["trainer"]),
  controller.createTemplateFromScratch
);
router.putAsync(
  "/workout-templates/:id",
  auth(["trainer"]),
  controller.updateTemplateMetadata
);
router.postAsync(
  "/workout-templates/:id/exercises",
  auth(["trainer"]),
  controller.addTemplateExercise
);
router.deleteAsync(
  "/workout-templates/:id/exercises/:customExerciseId",
  auth(["trainer"]),
  controller.deleteTemplateExercise
);
router.postAsync(
  "/workout-templates/:id/exercises/:customExerciseId/sets",
  auth(["trainer"]),
  controller.addTemplateSet
);
router.putAsync(
  "/workout-templates/:id/exercises/:customExerciseId/sets/:setId",
  auth(["trainer"]),
  controller.updateTemplateSet
);
router.deleteAsync(
  "/workout-templates/:id/exercises/:customExerciseId/sets/:setId",
  auth(["trainer"]),
  controller.deleteTemplateSet
);

module.exports = router;
