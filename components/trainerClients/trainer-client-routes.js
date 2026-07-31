const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-client-controller");

const router = express.Router();

// --- Lado profesional ---
router.postAsync("/invites", auth(["trainer"]), controller.inviteClient);
router.getAsync("/invites", auth(["trainer"]), controller.listInvitesByTrainer);
router.deleteAsync("/invites/:id", auth(["trainer"]), controller.cancelInvite);
router.getAsync("/clients", auth(["trainer"]), controller.listMyClients);
router.deleteAsync("/clients/:clientId", auth(["trainer"]), controller.revokeByTrainer);

// --- Lado cliente ---
router.getAsync("/invites/mine", auth(["user", "admin"]), controller.listInvitesMine);
router.postAsync("/invites/:id/accept", auth(["user", "admin"]), controller.acceptInvite);
router.postAsync("/invites/:id/decline", auth(["user", "admin"]), controller.declineInvite);
router.getAsync("/info", auth(["user", "admin"]), controller.listMyProfessionals);
router.deleteAsync("/link/:scope", auth(["user", "admin"]), controller.revokeByClient);

// --- Historial (F22) — accesible por ambos lados ---
router.getAsync("/history", auth(["trainer", "user", "admin"]), controller.listHistory);

module.exports = router;
