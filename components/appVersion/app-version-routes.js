const express = require("express");
const controller = require("./app-version-controller");

const router = express.Router();

router.get("/version", controller.getAppVersion);

module.exports = router;
