const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./client-progress-controller");

const router = express.Router();

// Montadas bajo /trainer (ver routes/index.js). Las dos pasan por
// requireActiveClient SIN scope: el resumen cruza nutrición y entrenamiento,
// y cualquiera de los dos ámbitos activos da derecho a verlo — un
// entrenador sin scope de nutrición sigue necesitando saber si su cliente
// entrena y se pesa. Cada dimensión sin datos se marca "no aplica" en la
// respuesta, así que no hay fuga de información entre ámbitos: lo que no
// existe, no aparece.
// Movimiento 1 Coach Pro — la Cartera. Declarada ANTES que las rutas con
// :clientId por convención del proyecto (lo más específico primero), aunque
// aquí no colisionen: "roster" no es un ObjectId y nunca entraría por
// /clients/:clientId.
//
// Sin requireActiveClient: no hay cliente en la URL, y el servicio parte de
// los clientes activos de quien pregunta. Ver controller.getRoster.
router.getAsync("/roster", auth(["trainer"]), controller.getRoster);

router.getAsync(
  "/clients/:clientId/summary",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getSummary
);

router.getAsync(
  "/clients/:clientId/progress",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getProgress
);

// Fase 6 — volumen, PRs y evolución de cargas. Ruta aparte por su coste:
// ver el comentario de getTrainingProgress.
router.getAsync(
  "/clients/:clientId/training-progress",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.getTrainingProgress
);

module.exports = router;
