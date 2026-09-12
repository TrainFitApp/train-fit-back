const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./notification-controller");

const router = express.Router();

router.postAsync("/notifications/devices", auth(["user", "admin"]), async (req, res) => {
  const { platform, token } = req.body || {};
  if (!["android", "ios"].includes(platform) || typeof token !== "string" || token.length < 16 || token.length > 4096 || /\s/.test(token)) return res.status(400).send({ message: "Dispositivo no válido" });
  await require("./push-device-schema").findOneAndUpdate({ platform, token }, {
    $set: { userId: req.auth.userId, sessionId: req.auth.sessionId },
  }, { upsert: true, setDefaultsOnInsert: true });
  return res.sendStatus(204);
});

router.getAsync("/notifications/mine", auth(["user", "admin"]), controller.listMine);
router.getAsync("/notifications/mine/unread-count", auth(["user", "admin"]), controller.countUnread);
router.patchAsync("/notifications/:id/read", auth(["user", "admin"]), controller.markRead);
router.postAsync("/notifications/mark-all-read", auth(["user", "admin"]), controller.markAllRead);

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
