const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./tutorial-controller");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getAll);

module.exports = router;
