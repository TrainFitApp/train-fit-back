const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./checkin-controller");
const agenda = require("./checkin-agenda-controller");
const { requireActiveClient } = require("../trainerClients/require-active-client");

const router = express.Router();

// --- Lado profesional: agenda y programación de un cliente ---
router.getAsync("/clients/:clientId/checkin-agenda", auth(["trainer"]), requireActiveClient(), agenda.agenda);
router.getAsync("/clients/:clientId/checkin-schedules", auth(["trainer"]), requireActiveClient(), agenda.listSchedules);
router.postAsync("/clients/:clientId/checkin-schedules", auth(["trainer"]), requireActiveClient(), agenda.saveSchedule);
// Antes de /:scheduleId a secas, o el genérico se comería la ruta literal.
router.getAsync(
  "/clients/:clientId/checkin-schedules/:scheduleId/history",
  auth(["trainer"]),
  requireActiveClient(),
  agenda.scheduleHistory
);
router.putAsync("/clients/:clientId/checkin-schedules/:scheduleId", auth(["trainer"]), requireActiveClient(), agenda.saveSchedule);
router.patchAsync("/clients/:clientId/checkin-schedules/:scheduleId/active", auth(["trainer"]), requireActiveClient(), agenda.setActive);
router.deleteAsync("/clients/:clientId/checkin-schedules/:scheduleId", auth(["trainer"]), requireActiveClient(), agenda.deleteSchedule);
router.postAsync("/clients/:clientId/checkin-responses/:responseId/review", auth(["trainer"]), requireActiveClient(), agenda.review);

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
router.getAsync(
  "/clients/:clientId/checkin-responses",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientCheckinResponses
);

// --- Lado cliente ---
router.getAsync("/checkins/mine", auth(["user", "admin"]), controller.listMine);
router.getAsync("/checkins/mine/history", auth(["user", "admin"]), controller.listMyHistory);
router.postAsync("/checkins/:scheduleId/respond", auth(["user", "admin"]), controller.respond);

module.exports = router;
