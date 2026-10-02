const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./hidden-recent-food-controller");

const router = express.Router();

// Montadas bajo /recent-foods. Solo el propio cliente: siempre actúa sobre
// req.auth.userId, nunca sobre un id que llegue en la petición.
router.postAsync("/hidden", auth(["admin", "user"]), controller.hide);
router.postAsync("/hidden/restore", auth(["admin", "user"]), controller.restore);

module.exports = router;
