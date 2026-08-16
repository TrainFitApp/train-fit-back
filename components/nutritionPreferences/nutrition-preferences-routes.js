const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./nutrition-preferences-controller");

// Lado cliente — se monta en routes/index.js bajo /nutrition-preferences.
const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getMine);
router.putAsync("/", auth(["admin", "user"]), controller.updateMine);

module.exports = router;
