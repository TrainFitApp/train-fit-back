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

// --- TAREA 3: cuestionario inicial — el profesional revisa/confirma ANTES
// de que la relación esté "active", por eso NO llevan requireActiveClient.
router.getAsync("/clients/:clientId/intake", auth(["trainer"]), controller.getClientIntake);
router.postAsync("/clients/:clientId/confirm", auth(["trainer"]), controller.confirmClient);

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
router.getAsync(
  "/clients/:clientId/notes",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.listNotes
);
router.postAsync(
  "/clients/:clientId/notes",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.createNote
);
router.patchAsync(
  "/clients/:clientId/notes/:noteId",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.setNotePinned
);
router.getAsync(
  "/clients/:clientId/adherence",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientAdherence
);
router.getAsync(
  "/clients/:clientId/payments",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.listPayments
);
router.postAsync(
  "/clients/:clientId/payments",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.createPayment
);
router.patchAsync(
  "/clients/:clientId/payments/:paymentId",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.setPaymentPaid
);
router.postAsync(
  "/clients/:clientId/diet-days/:date/meals/:mealSlot/propose",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.proposeMealAlternatives
);
router.getAsync(
  "/clients/:clientId/nutrition-preferences",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientNutritionPreferences
);
router.postAsync(
  "/clients/:clientId/nutrition-preferences/request",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.requestNutritionPreferences
);

// --- F30: aplicar en bloque a varios clientes (cada uno validado individualmente dentro) ---
router.postAsync(
  "/routines/:routineId/apply-to-clients",
  auth(["trainer"]),
  dataController.applyRoutineToClients
);
router.postAsync(
  "/clients/:clientId/diet-days/:date/meals/:mealSlot/apply-to-clients",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.applyMealToClients
);
router.postAsync(
  "/clients/:clientId/nutrition-goals/apply-to-clients",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.applyGoalToClients
);

// --- Lado cliente ---
router.getAsync("/invites/mine", auth(["user", "admin"]), controller.listInvitesMine);
router.postAsync("/invites/:id/accept", auth(["user", "admin"]), controller.acceptInvite);
router.postAsync("/invites/:id/decline", auth(["user", "admin"]), controller.declineInvite);
router.getAsync("/info", auth(["user", "admin"]), controller.listMyProfessionals);
router.deleteAsync("/link/:scope", auth(["user", "admin"]), controller.revokeByClient);

// --- TAREA 3: cuestionario inicial — lado cliente ---
router.getAsync("/onboarding-status", auth(["user", "admin"]), controller.getOnboardingStatus);
router.postAsync("/intake", auth(["user", "admin"]), controller.submitIntake);

// --- Historial (F22) — accesible por ambos lados ---
router.getAsync("/history", auth(["trainer", "user", "admin"]), controller.listHistory);

module.exports = router;
