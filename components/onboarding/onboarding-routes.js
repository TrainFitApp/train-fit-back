const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./onboarding-controller");

const router = express.Router();

router.postAsync("/tutorials/complete", auth(["admin", "user"]), controller.complete);
router.postAsync("/tutorials/reopen", auth(["admin", "user"]), controller.reopen);

module.exports = router;
