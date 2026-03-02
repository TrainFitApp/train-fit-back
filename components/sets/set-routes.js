const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./set-controller");
// const ROLES = require('../users/util/roles');

const router = express.Router();

router.getAsync("/:id", auth(["admin", "user"]), controller.getSetById);
router.postAsync("/one", auth(["admin", "user"]), controller.createSet);
router.postAsync("/", auth(["admin", "user"]), controller.createSets);
router.putAsync("/", auth(["admin", "user"]), controller.updateSet);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteById);

module.exports = router;
