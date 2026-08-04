const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./notification-controller");

const router = express.Router();

router.getAsync("/notifications/mine", auth(["user", "admin"]), controller.listMine);
router.getAsync("/notifications/mine/unread-count", auth(["user", "admin"]), controller.countUnread);
router.patchAsync("/notifications/:id/read", auth(["user", "admin"]), controller.markRead);
router.postAsync("/notifications/mark-all-read", auth(["user", "admin"]), controller.markAllRead);

module.exports = router;
