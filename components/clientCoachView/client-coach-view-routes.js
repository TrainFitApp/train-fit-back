const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./client-coach-view-controller");

const router = express.Router();

router.getAsync("/coach/dashboard", auth(["user", "admin"]), controller.getDashboard);

module.exports = router;
