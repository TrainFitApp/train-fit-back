const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./notification-controller");

const router = express.Router();

router.getAsync("/notifications/mine", auth(["user", "admin"]), controller.listMine);
router.getAsync("/notifications/mine/unread-count", auth(["user", "admin"]), controller.countUnread);
router.patchAsync("/notifications/:id/read", auth(["user", "admin"]), controller.markRead);
router.postAsync("/notifications/mark-all-read", auth(["user", "admin"]), controller.markAllRead);
router.deleteAsync("/notifications/:id", auth(["user", "admin"]), controller.remove);

// Dashboard trainer (2026-08-18) — mismo recurso, sentido inverso.
router.getAsync("/trainer/notifications/mine", auth(["trainer"]), controller.listMineTrainer);
router.getAsync(
  "/trainer/notifications/mine/unread-count",
  auth(["trainer"]),
  controller.countUnreadTrainer
);
router.patchAsync("/trainer/notifications/:id/read", auth(["trainer"]), controller.markReadTrainer);
router.postAsync(
  "/trainer/notifications/mark-all-read",
  auth(["trainer"]),
  controller.markAllReadTrainer
);

module.exports = router;
