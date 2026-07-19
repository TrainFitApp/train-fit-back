const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./nutritional-goal-controller");

const router = express.Router();

router.postAsync("/", auth(["admin", "user"]), controller.create);
router.getAsync("/", auth(["admin", "user"]), controller.getAllByUserId);
router.putAsync("/:id/activate", auth(["admin", "user"]), controller.activate);
router.getAsync("/:id", auth(["admin", "user"]), controller.getById);
router.putAsync("/:id", auth(["admin", "user"]), controller.update);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.remove);

module.exports = router;
