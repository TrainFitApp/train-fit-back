const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./notification-controller");

// Compartido — el rol determina el lado (ver controller.js#isTrainer), mismo
// criterio que trainer-client-routes.js#revoke (funcionalidad 2).
const router = express.Router();

router.getAsync("/notifications", auth(["trainer", "admin", "user"]), controller.listMine);
router.getAsync(
  "/notifications/unread-count",
  auth(["trainer", "admin", "user"]),
  controller.getUnreadCount
);
router.putAsync(
  "/notifications/:id/read",
  auth(["trainer", "admin", "user"]),
  controller.markRead
);
router.postAsync(
  "/notifications/mark-all-read",
  auth(["trainer", "admin", "user"]),
  controller.markAllRead
);

module.exports = router;
