const express = require("@awaitjs/express");
const controller = require("./auth-controller");
const { auth, basicAuth } = require("../../middleware/validateAuth");

const router = express.Router();

// router.postAsync("/login", basicAuth, controller.refreshToken);

module.exports = router;
