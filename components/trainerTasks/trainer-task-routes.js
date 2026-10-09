const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./trainer-task-controller");

const router = express.Router();

// --- Lado profesional ---
router.postAsync(
  "/trainer/clients/:clientId/tasks",
  auth(["trainer"]),
  requireActiveClient(),
  controller.createTask
);
router.getAsync(
  "/trainer/clients/:clientId/tasks",
  auth(["trainer"]),
  requireActiveClient(),
  controller.listClientTasks
);
router.putAsync(
  "/trainer/clients/:clientId/tasks/:taskId",
  auth(["trainer"]),
  requireActiveClient(),
  controller.updateTask
);
router.deleteAsync(
  "/trainer/clients/:clientId/tasks/:taskId",
  auth(["trainer"]),
  requireActiveClient(),
  controller.deactivateTask
);

// --- Lado cliente ---
router.getAsync("/trainer/tasks/mine", auth(["user", "admin"]), controller.listMine);
router.postAsync("/trainer/tasks/:taskId/toggle", auth(["user", "admin"]), controller.toggleCompletion);

module.exports = router;
