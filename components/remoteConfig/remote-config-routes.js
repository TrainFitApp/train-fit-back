const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./remote-config-controller");

const router = express.Router();

router.getAsync("/", controller.getPublicStatus);
router.getAsync("/admin", auth(["admin"]), controller.getAdminConfig);
router.putAsync("/admin", auth(["admin"]), controller.updateAdminConfig);

module.exports = router;
