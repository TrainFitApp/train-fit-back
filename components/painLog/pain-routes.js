const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./pain-controller");

const router = express.Router();

// El catálogo lo pueden leer los dos lados: es el mismo vocabulario para
// quien apunta el dolor y para quien lo lee.
router.getAsync("/pain/catalog", auth(["user", "admin", "trainer"]), controller.getCatalog);

// --- Lado cliente ---
// Rutas bajo /pain/mine, sin :clientId: el usuario del token ES el dueño del
// registro, y aceptar un id por la URL sería abrir la puerta a leer el dolor
// de otro. Mismo criterio que /trainer/tasks/mine.
router.getAsync("/pain/mine", auth(["user", "admin"]), controller.listMine);
router.getAsync("/pain/mine/history", auth(["user", "admin"]), controller.listMyHistory);
router.putAsync("/pain/mine", auth(["user", "admin"]), controller.upsertMine);
router.deleteAsync("/pain/mine", auth(["user", "admin"]), controller.removeMine);

// --- Lado profesional ---
// requireActiveClient SIN scope: una molestia condiciona el entrenamiento y
// también la nutrición (una lesión cambia el gasto), y cualquiera de los dos
// ámbitos activos da derecho a verla. Mismo criterio que clientProgress.
router.getAsync(
  "/trainer/clients/:clientId/pain",
  auth(["trainer"]),
  requireActiveClient(),
  controller.getClientPain
);
router.putAsync(
  "/trainer/clients/:clientId/pain/thresholds",
  auth(["trainer"]),
  requireActiveClient(),
  controller.upsertThreshold
);
router.deleteAsync(
  "/trainer/clients/:clientId/pain/thresholds/:zone",
  auth(["trainer"]),
  requireActiveClient(),
  controller.removeThreshold
);

module.exports = router;
