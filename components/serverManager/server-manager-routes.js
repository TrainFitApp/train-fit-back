const express = require("@awaitjs/express");
const controller = require("./server-manager-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

router.postAsync("/restart", auth(["admin"]), controller.restart);

module.exports = router;
