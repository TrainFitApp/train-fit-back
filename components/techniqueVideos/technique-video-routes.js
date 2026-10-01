const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./technique-video-controller");

const router = express.Router();

// Sin prefijo común (como painRoutes): sirve a los dos lados.
router.getAsync("/trainer/technique-videos", auth(["trainer"]), controller.listMine);
router.postAsync("/trainer/technique-videos", auth(["trainer"]), controller.create);
router.putAsync("/trainer/technique-videos/:id", auth(["trainer"]), controller.update);
router.deleteAsync("/trainer/technique-videos/:id", auth(["trainer"]), controller.remove);

router.getAsync(
  "/trainer/clients/:clientId/technique-videos",
  auth(["trainer"]),
  requireActiveClient("training", { allowReadOnly: true }),
  controller.clientOverrides
);
router.putAsync(
  "/trainer/clients/:clientId/technique-videos/:exerciseId",
  auth(["trainer"]),
  requireActiveClient("training"),
  controller.setClientOverride
);

router.getAsync("/technique-videos/mine", auth(["user", "admin"]), controller.forMe);

module.exports = router;
