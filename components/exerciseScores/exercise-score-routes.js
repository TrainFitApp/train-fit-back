const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./exercise-score-controller");

const router = express.Router();

// Montadas bajo /trainer (ver routes/index.js). Todo aquí es del propio
// profesional: no hay :clientId, porque una puntuación no es de un cliente
// sino del método del entrenador. Por eso tampoco pasan por
// requireActiveClient.

// Rutas literales ANTES de "/exercise-scores/:exerciseId": "bulk" y
// "catalog" no son ObjectIds, pero el router prueba en orden y lo más
// específico va primero (mismo criterio que el resto del proyecto).
router.getAsync("/exercise-scores/catalog", auth(["trainer"]), controller.getCatalog);
router.putAsync("/exercise-scores/bulk", auth(["trainer"]), controller.bulkUpsert);
router.getAsync(
  "/exercise-scores/session/:workoutId",
  auth(["trainer"]),
  controller.getSessionLoad
);
// 2026-09 — sugerencia inicial para el editor cuando el entrenador todavía
// no ha puntuado ESTE ejercicio (ver exercise-score-defaults.js). Tres
// segmentos, no choca con "/exercise-scores/:exerciseId" aunque fuera
// después.
router.getAsync(
  "/exercise-scores/default/:exerciseId",
  auth(["trainer"]),
  controller.getDefault
);

router.getAsync("/exercise-scores", auth(["trainer"]), controller.listMine);
router.putAsync("/exercise-scores/:exerciseId", auth(["trainer"]), controller.upsert);
router.deleteAsync("/exercise-scores/:exerciseId", auth(["trainer"]), controller.remove);

module.exports = router;
