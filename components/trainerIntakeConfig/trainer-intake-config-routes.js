const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-intake-config-controller");

const router = express.Router();

// TASK-049 (MASTER_BACKLOG.md) — el profesional elige qué pregunta y qué
// pide (medidas, fotos y vídeos) en el cuestionario inicial de sus clientes.
// El lado cliente no necesita endpoint propio: getOnboardingStatus
// (trainer-client-routes.js) ya lo adjunta por cada profesional.
router.getAsync("/intake-config", auth(["trainer"]), controller.getMyConfig);
router.putAsync("/intake-config", auth(["trainer"]), controller.updateMyConfig);

module.exports = router;
