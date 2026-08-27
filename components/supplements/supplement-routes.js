const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./supplement-controller");

const router = express.Router();

// El vocabulario de "cuándo tomarlo" lo leen los dos lados.
router.getAsync(
  "/supplements/timings",
  auth(["user", "admin", "trainer"]),
  controller.getTimings
);

// --- Lado cliente ---
// Sin :clientId: el usuario del token es el dueño de la pauta. Mismo criterio
// que /trainer/tasks/mine y /pain/mine.
router.getAsync("/supplements/mine", auth(["user", "admin"]), controller.listMine);

// --- Lado profesional ---
// requireActiveClient SIN scope: un suplemento lo pauta tanto el entrenador
// como el nutricionista, y ninguno de los dos ámbitos lo excluye.
router.getAsync(
  "/trainer/clients/:clientId/supplements",
  auth(["trainer"]),
  requireActiveClient(),
  controller.listForClient
);
router.postAsync(
  "/trainer/clients/:clientId/supplements",
  auth(["trainer"]),
  requireActiveClient(),
  controller.create
);
router.putAsync(
  "/trainer/clients/:clientId/supplements/:supplementId",
  auth(["trainer"]),
  requireActiveClient(),
  controller.update
);
router.deleteAsync(
  "/trainer/clients/:clientId/supplements/:supplementId",
  auth(["trainer"]),
  requireActiveClient(),
  controller.remove
);

module.exports = router;
