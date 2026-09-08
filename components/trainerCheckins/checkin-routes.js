const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./checkin-controller");
const calendar = require("./checkin-calendar-controller");
const { requireActiveClient } = require("../trainerClients/require-active-client");

const router = express.Router();

router.getAsync("/clients/:clientId/checkin-calendar", auth(["trainer"]), requireActiveClient(), calendar.calendar);
router.postAsync("/clients/:clientId/checkin-schedules", auth(["trainer"]), requireActiveClient(), calendar.saveSchedule);
router.putAsync("/clients/:clientId/checkin-schedules/:scheduleId", auth(["trainer"]), requireActiveClient(), calendar.saveSchedule);
router.patchAsync("/clients/:clientId/checkin-schedules/:scheduleId/active", auth(["trainer"]), requireActiveClient(), calendar.setActive);
router.postAsync("/clients/:clientId/checkin-schedules/:scheduleId/request", auth(["trainer"]), requireActiveClient(), calendar.requestNow);
router.postAsync("/clients/:clientId/checkin-requests/:requestId/review", auth(["trainer"]), requireActiveClient(), calendar.review);
router.postAsync("/checkins/requests/:requestId/respond", auth(["user", "admin"]), calendar.respond);

// --- Lado profesional: plantillas maestras ---
router.getAsync("/checkin-templates", auth(["trainer"]), controller.listDefinitions);
router.postAsync("/checkin-templates", auth(["trainer"]), controller.createDefinition);
router.putAsync("/checkin-templates/:id", auth(["trainer"]), controller.updateDefinition);
router.deleteAsync("/checkin-templates/:id", auth(["trainer"]), controller.deleteDefinition);
router.postAsync("/checkin-templates/:id/apply", auth(["trainer"]), controller.applyDefinition);

// --- Lado profesional: "Reportes" — histórico agregado de TODOS sus clientes ---
router.getAsync("/checkins/responses", auth(["trainer"]), controller.getMyCheckinResponses);
router.getAsync("/checkins/unseen-count", auth(["trainer"]), controller.getUnseenCount);
router.postAsync("/checkins/mark-seen", auth(["trainer"]), controller.markSeen);

// --- Lado profesional: configuración/histórico de un cliente concreto ---
router.getAsync(
  "/clients/:clientId/checkin-config",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientCheckinConfig
);
router.getAsync(
  "/clients/:clientId/checkin-responses",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientCheckinResponses
);

// --- Lado cliente ---
router.getAsync("/checkins/mine", auth(["user", "admin"]), controller.listMine);
// coach-tab FASE2 — "formularios completados", histórico agregado del cliente.
router.getAsync("/checkins/mine/history", auth(["user", "admin"]), controller.listMyHistory);
router.postAsync("/checkins/:trainerId/respond", auth(["user", "admin"]), controller.respond);

module.exports = router;
