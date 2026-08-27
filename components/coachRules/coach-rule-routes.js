const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./coach-rule-controller");

const router = express.Router();

// Montadas bajo /trainer (ver routes/index.js). El catálogo va ANTES que
// /rules/:id — si no, Express intentaría resolver "catalog" como un id.
router.getAsync("/rules/catalog", auth(["trainer"]), controller.getCatalog);
router.getAsync("/rules", auth(["trainer"]), controller.listMine);
router.postAsync("/rules", auth(["trainer"]), controller.create);
router.patchAsync("/rules/:id/toggle", auth(["trainer"]), controller.toggle);
router.putAsync("/rules/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/rules/:id", auth(["trainer"]), controller.remove);

module.exports = router;
