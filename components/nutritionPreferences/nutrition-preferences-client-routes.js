const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./nutrition-preferences-client-controller");

const router = express.Router();

router.getAsync("/nutrition-preferences", auth(["user", "admin"]), controller.getMine);
router.putAsync("/nutrition-preferences", auth(["user", "admin"]), controller.updateMine);

module.exports = router;
