const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./coach-dashboard-controller");

const router = express.Router();

router.getAsync("/dashboard", auth(["trainer"]), controller.getDashboard);

module.exports = router;
