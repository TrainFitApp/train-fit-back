const express = require("@awaitjs/express");
const controller = require("./env-manager-controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

router.getAsync("/", auth(["admin"]), controller.list);
router.postAsync("/", auth(["admin"]), controller.create);
router.putAsync("/:key", auth(["admin"]), controller.update);
router.putAsync("/:key/toggle", auth(["admin"]), controller.toggle);
router.deleteAsync("/:key", auth(["admin"]), controller.remove);

module.exports = router;
