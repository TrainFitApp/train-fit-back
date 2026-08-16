const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-client-controller");

const router = express.Router();

// --- Lado trainer ---
router.postAsync("/invites", auth(["trainer"]), controller.invite);
router.getAsync("/invites", auth(["trainer"]), controller.listMyInvites);
router.deleteAsync("/invites/:id", auth(["trainer"]), controller.cancelInvite);

router.getAsync("/clients", auth(["trainer"]), controller.listMyClients);
router.getAsync(
  "/clients/:clientId",
  auth(["trainer"]),
  controller.getClientSummary
);
router.getAsync(
  "/clients/:clientId/intake",
  auth(["trainer"]),
  controller.getClientIntake
);
router.postAsync(
  "/clients/:clientId/confirm",
  auth(["trainer"]),
  controller.confirmClient
);

// --- Lado cliente ---
router.getAsync(
  "/invites/mine",
  auth(["admin", "user"]),
  controller.listInvitesForMe
);
router.postAsync(
  "/invites/:id/accept",
  auth(["admin", "user"]),
  controller.acceptInvite
);
router.postAsync(
  "/invites/:id/decline",
  auth(["admin", "user"]),
  controller.declineInvite
);
router.postAsync(
  "/trainers/:trainerId/intake",
  auth(["admin", "user"]),
  controller.submitIntake
);

// --- Compartido (el rol determina el lado, ver controller.revoke) ---
router.deleteAsync(
  "/relations/:id",
  auth(["trainer", "admin", "user"]),
  controller.revoke
);
router.postAsync(
  "/relations/:id/reactivate",
  auth(["trainer"]),
  controller.reactivateClient
);

// --- Notas (funcionalidad 11) / Cobros (funcionalidad 12) — sub-recursos
// simples de la relación, sin componente HTTP propio (ver
// docs/trainfit-trainers/05-especificaciones-acordadas.md).
router.postAsync("/relations/:id/notes", auth(["trainer"]), controller.addNote);
router.putAsync("/relations/:id/notes/:noteId", auth(["trainer"]), controller.updateNote);
router.deleteAsync("/relations/:id/notes/:noteId", auth(["trainer"]), controller.removeNote);

router.postAsync("/relations/:id/payments", auth(["trainer"]), controller.addPayment);
router.putAsync(
  "/relations/:id/payments/:paymentId/paid",
  auth(["trainer"]),
  controller.markPaymentPaid
);
router.deleteAsync(
  "/relations/:id/payments/:paymentId",
  auth(["trainer"]),
  controller.removePayment
);

module.exports = router;
