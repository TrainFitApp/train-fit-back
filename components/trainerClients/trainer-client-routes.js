const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-client-controller");
const dataController = require("./trainer-client-data-controller");
const { requireActiveClient } = require("./require-active-client");

const router = express.Router();

// --- Lado profesional ---
router.postAsync("/invites", auth(["trainer"]), controller.inviteClient);
router.getAsync("/invites", auth(["trainer"]), controller.listInvitesByTrainer);
router.deleteAsync("/invites/:id", auth(["trainer"]), controller.cancelInvite);
router.getAsync("/clients", auth(["trainer"]), controller.listMyClients);
router.deleteAsync("/clients/:clientId", auth(["trainer"]), controller.revokeByTrainer);

// --- Datos del cliente (F09/F10/F11/F13) ---
router.getAsync(
  "/clients/:clientId/tables/available-templates",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getAvailableTemplates
);
router.getAsync(
  "/clients/:clientId/tables",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getClientTables
);
router.postAsync(
  "/clients/:clientId/tables",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.assignTable
);
router.getAsync(
  "/clients/:clientId/workouts/history",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getClientWorkoutHistory
);
router.getAsync(
  "/clients/:clientId/anthropometry",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.getClientAnthropometry
);
router.getAsync(
  "/clients/:clientId/diet",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientDiet
);
router.getAsync(
  "/clients/:clientId/nutritional-goals",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientNutritionalGoals
);
router.postAsync(
  "/clients/:clientId/nutritional-goals",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.assignNutritionalGoal
);
router.postAsync(
  "/clients/:clientId/diet-days/:date/meals/:mealId/prescribe",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.prescribeMeal
);

// --- Lado cliente ---
router.getAsync("/invites/mine", auth(["user", "admin"]), controller.listInvitesMine);
router.postAsync("/invites/:id/accept", auth(["user", "admin"]), controller.acceptInvite);
router.postAsync("/invites/:id/decline", auth(["user", "admin"]), controller.declineInvite);
router.getAsync("/info", auth(["user", "admin"]), controller.listMyProfessionals);
router.deleteAsync("/link/:scope", auth(["user", "admin"]), controller.revokeByClient);

// --- Historial (F22) — accesible por ambos lados ---
router.getAsync("/history", auth(["trainer", "user", "admin"]), controller.listHistory);

module.exports = router;
