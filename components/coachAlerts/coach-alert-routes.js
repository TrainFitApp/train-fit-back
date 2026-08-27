const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./coach-alert-controller");

const router = express.Router();

// Montadas bajo /trainer (ver routes/index.js) — mismo prefijo y mismo gate
// de rol que el resto del módulo del profesional.
//
// No hay ruta "alertas de UN cliente" todavía: la consumiría la pestaña
// Resumen de la ficha, que es Fase 2. Construirla ahora sería un endpoint
// que nadie llama.
router.getAsync("/alerts", auth(["trainer"]), controller.listMine);
router.patchAsync("/alerts/:id", auth(["trainer"]), controller.setStatus);
router.postAsync("/alerts/evaluate", auth(["trainer"]), controller.evaluateMine);

module.exports = router;
