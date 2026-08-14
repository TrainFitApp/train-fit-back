const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-intake-config-controller");

const router = express.Router();

// TASK-049 (MASTER_BACKLOG.md) — el profesional elige qué campos del
// cuestionario inicial muestra a sus clientes. El lado cliente no necesita
// endpoint propio: getOnboardingStatus (trainer-client-routes.js) ya adjunta
// enabledFields por cada relación pendiente.
router.getAsync("/intake-config", auth(["trainer"]), controller.getMyConfig);
router.putAsync("/intake-config", auth(["trainer"]), controller.updateMyConfig);

module.exports = router;
