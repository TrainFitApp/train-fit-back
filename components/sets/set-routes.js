const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./set-controller");

const router = express.Router();

router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateSet);
router.deleteAsync("/:id", auth(["admin", "user", "trainer"]), controller.deleteById);

module.exports = router;
