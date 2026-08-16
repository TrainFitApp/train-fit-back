const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-intake-config-controller");

const router = express.Router();

router.getAsync("/intake-config", auth(["trainer"]), controller.getMine);
router.putAsync("/intake-config", auth(["trainer"]), controller.updateMine);
// Catálogo de campos posibles, accesible también al cliente para pintar el
// cuestionario que responde.
router.getAsync(
  "/intake-fields",
  auth(["trainer", "admin", "user"]),
  controller.getCatalog
);
router.getAsync(
  "/trainers/:trainerId/intake-config",
  auth(["admin", "user"]),
  controller.getForTrainer
);

module.exports = router;
