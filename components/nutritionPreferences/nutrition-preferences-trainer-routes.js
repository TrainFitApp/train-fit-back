const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./nutrition-preferences-controller");

// Lado trainer — se monta en routes/index.js bajo /trainer.
const router = express.Router();

router.postAsync(
  "/clients/:clientId/nutrition-preferences/request",
  auth(["trainer"]),
  controller.requestUpdate
);
router.getAsync(
  "/clients/:clientId/nutrition-preferences",
  auth(["trainer"]),
  controller.getForClient
);

module.exports = router;
