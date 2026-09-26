const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-client-controller");
const dataController = require("./trainer-client-data-controller");
const { requireActiveClient, requireWritableSeat } = require("./require-active-client");
const workoutTemplateController = require("../workoutTemplates/workout-template-controller");

const router = express.Router();

// --- Lado profesional ---
router.postAsync("/invites", auth(["trainer"]), controller.inviteClient);
router.getAsync("/invites", auth(["trainer"]), controller.listInvitesByTrainer);
router.deleteAsync("/invites/:id", auth(["trainer"]), controller.cancelInvite);
router.getAsync("/clients", auth(["trainer"]), controller.listMyClients);
router.getAsync("/clients/paginated", auth(["trainer"]), controller.listMyClientsPaginated);
router.getAsync("/clients/lifetime-count", auth(["trainer"]), controller.getLifetimeClientsCount);
router.getAsync("/payments/summary", auth(["trainer"]), controller.getPaymentsSummary);
router.getAsync("/dashboard/attention-items", auth(["trainer"]), controller.getAttentionItems);
router.getAsync("/clients/check-email", auth(["trainer"]), controller.checkClientEmailStatus);
router.deleteAsync("/clients/:clientId", auth(["trainer"]), controller.revokeByTrainer);

// --- TAREA 3: cuestionario inicial — el profesional revisa/confirma ANTES
// de que la relación esté "active", por eso NO llevan requireActiveClient.
router.getAsync("/clients/:clientId/intake", auth(["trainer"]), controller.getClientIntake);
router.putAsync("/clients/:clientId/intake", auth(["trainer"]), requireWritableSeat(), controller.updateClientIntake);
router.postAsync("/clients/:clientId/confirm", auth(["trainer"]), requireWritableSeat(), controller.confirmClient);

// Plazas activas cuando la cartera supera el cupo del plan (trainer-seat-service.js).
router.getAsync("/seats", auth(["trainer"]), controller.getSeats);
router.putAsync("/seats", auth(["trainer"]), controller.updateSeats);

// --- Datos del cliente (F09/F10/F11/F13) ---
router.getAsync(
  "/clients/:clientId/tables/available-templates",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getAvailableTemplates
);
router.getAsync(
  "/clients/:clientId/training-goal",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getTrainingGoal
);
router.putAsync(
  "/clients/:clientId/training-goal",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.updateTrainingGoal
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
router.putAsync(
  "/clients/:clientId/tables/:tableId/activate",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.activateTable
);
router.getAsync(
  "/clients/:clientId/workouts/history",
  auth(["trainer"]),
  requireActiveClient("training"),
  dataController.getClientWorkoutHistory
);
// Rediseño de entrenamiento (Fase A) — aplica una WorkoutTemplate real dentro
// de un split concreto del cliente, materializando exercises/sets ya
// prescritos (ver workoutTemplates/workout-template-dao.js#applyToSplit).
router.postAsync(
  "/clients/:clientId/splits/:splitId/workout-templates/:templateId/apply",
  auth(["trainer"]),
  requireActiveClient("training"),
  workoutTemplateController.applyTemplateToSplit
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
router.postAsync(
  "/clients/:clientId/diet-days/:date/meals/:mealId/prescribe",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.prescribeMeal
);
router.getAsync(
  "/clients/:clientId/previous-relation-cutoff",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.getPreviousRelationCutoff
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
  dataController.updateNote
);
router.deleteAsync(
  "/clients/:clientId/notes/:noteId",
  auth(["trainer"]),
  requireActiveClient(),
  dataController.deleteNote
);
router.getAsync(
  "/clients/:clientId/adherence",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientAdherence
);
router.getAsync(
  "/clients/:clientId/nutrition-compliance",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientNutritionCompliance
);
router.getAsync(
  "/clients/:clientId/nutrition-tracking",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientNutritionTracking
);
// Cumplimiento alimento a alimento del rango — panel de resumen de una semana.
router.getAsync(
  "/clients/:clientId/nutrition-foods",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientNutritionFoods
);
// Movimiento 5 Coach Pro — lista de la compra del plan. requireActiveClient
// CON scope "nutrition", igual que sus vecinas de arriba: es contenido del
// plan nutricional, y un entrenador solo de entrenamiento no lo pauta.
router.getAsync(
  "/clients/:clientId/shopping-list",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.getClientShoppingList
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
// El profesional edita directamente las preferencias del cliente en vez de
// esperar a que este responda el cuestionario.
router.putAsync(
  "/clients/:clientId/nutrition-preferences",
  auth(["trainer"]),
  requireActiveClient("nutrition"),
  dataController.updateClientNutritionPreferences
);

// --- Rutinas -> Plantillas (rediseño 2026-08): biblioteca de plantillas de
// rutina completa del profesional, editada con el mismo Planificador que ya
// usa para las rutinas reales de sus clientes (ver planner.page.ts) ---
router.getAsync("/routines", auth(["trainer"]), dataController.listOwnRoutines);
router.postAsync("/routines", auth(["trainer"]), dataController.createOwnRoutine);
router.deleteAsync("/routines/:id", auth(["trainer"]), dataController.deleteOwnRoutine);

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
// TAREA5 (auditoría UX, Fase D) — mismo reparto en bloque que la ruta de
// arriba, pero SIN cliente origen: la comida se compone una vez desde un
// punto de entrada propio ("Componer para varios clientes") y se aplica
// directo a cada destinatario. requireActiveClient no aplica aquí porque no
// hay un único cliente fijo en la URL — cada targetClientId se valida por
// separado dentro de applyToTargets(), igual que ya hacían las otras rutas
// de aplicar en bloque.
router.postAsync(
  "/meals/apply-to-clients",
  auth(["trainer"]),
  dataController.applyMealToClientsDirect
);

// --- Lado cliente ---
router.getAsync("/invites/mine", auth(["user", "admin"]), controller.listInvitesMine);
router.postAsync("/invites/:id/accept", auth(["user", "admin"]), controller.acceptInvite);
router.postAsync("/invites/:id/decline", auth(["user", "admin"]), controller.declineInvite);
router.getAsync("/info", auth(["user", "admin"]), controller.listMyProfessionals);
router.deleteAsync("/link/:scope", auth(["user", "admin"]), controller.revokeByClient);

// --- TAREA 3: cuestionario inicial — lado cliente ---
router.getAsync("/onboarding-status", auth(["user", "admin"]), controller.getOnboardingStatus);
router.getAsync("/intake/:trainerId", auth(["user", "admin"]), controller.getMyIntake);
router.postAsync("/intake", auth(["user", "admin"]), controller.submitIntake);

// --- Historial (F22) — accesible por ambos lados ---
router.getAsync("/history", auth(["trainer", "user", "admin"]), controller.listHistory);

module.exports = router;
