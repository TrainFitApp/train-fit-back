const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-proposal-client-controller");

const router = express.Router();

router.getAsync("/:date/meal-proposals", auth(["user", "admin"]), controller.listForDate);
router.postAsync("/:date/meal-proposals/:proposalId/choose", auth(["user", "admin"]), controller.choose);

module.exports = router;
