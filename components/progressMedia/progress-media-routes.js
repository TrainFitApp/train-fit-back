const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./progress-media-controller");

const router = express.Router();
const CLIENT = ["user", "admin"];

// Sin prefijo común, como painRoutes: sirve a los dos lados y cada ruta
// lleva escrito el suyo. El cliente siempre es el usuario del token.
router.getAsync("/progress-media/mine", auth(CLIENT), controller.listMine);
router.getAsync("/progress-media/mine/trainers", auth(CLIENT), controller.listTrainers);
router.putAsync("/progress-media/mine/trainers/:trainerId/history", auth(CLIENT), controller.setHistory);
router.putAsync("/progress-media/mine/:date/photos/:pose", auth(CLIENT), controller.setPhoto);
router.deleteAsync("/progress-media/mine/:date/photos/:pose", auth(CLIENT), controller.removePhoto);
router.postAsync("/progress-media/mine/:date/videos", auth(CLIENT), controller.addVideo);
router.deleteAsync("/progress-media/mine/:date/videos/:assetId", auth(CLIENT), controller.removeVideo);
router.patchAsync("/progress-media/mine/:date", auth(CLIENT), controller.updateDay);

// Cualquier scope activo: el nutricionista también ve las fotos (decisión 5).
router.getAsync(
  "/trainer/clients/:clientId/progress-media",
  auth(["trainer"]),
  requireActiveClient(null, { allowReadOnly: true }),
  controller.listForTrainer
);
router.getAsync(
  "/trainer/clients/:clientId/progress-media/:dayId",
  auth(["trainer"]),
  requireActiveClient(null, { allowReadOnly: true }),
  controller.dayForTrainer
);

module.exports = router;
