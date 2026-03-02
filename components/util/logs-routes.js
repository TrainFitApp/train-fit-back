const express = require("@awaitjs/express");
const controller = require("./logs-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

// GET /logs/read - Requiere rol ADMIN
router.getAsync("/read", auth(["admin"]), controller.readLogs);

module.exports = router;
