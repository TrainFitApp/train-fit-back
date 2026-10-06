const express = require("@awaitjs/express");
const controller = require("./app-version-controller");

const router = express.Router();

router.getAsync("/version", controller.getAppVersion);

module.exports = router;
