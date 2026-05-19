const express = require("@awaitjs/express");
const controller = require("./git-manager-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

router.getAsync("/token", auth(["admin"]), controller.getToken);
router.putAsync("/token", auth(["admin"]), controller.saveToken);
router.postAsync("/pull", auth(["admin"]), controller.pull);

module.exports = router;
