const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./review-queue-controller");

const router = express.Router();

// Montadas bajo /trainer: bandeja «Por revisar» (check-ins sin revisar,
// revisiones de técnica y cuestionarios de alta) y su contador del menú.
router.getAsync("/review-queue", auth(["trainer"]), controller.list);
router.getAsync("/review-queue/count", auth(["trainer"]), controller.count);

module.exports = router;
