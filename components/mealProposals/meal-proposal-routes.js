const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./meal-proposal-controller");

// Lado trainer — se monta en routes/index.js bajo /trainer.
const trainerRouter = express.Router();

trainerRouter.postAsync(
  "/clients/:clientId/meals/pin",
  auth(["trainer"]),
  controller.pinMeal
);
trainerRouter.postAsync(
  "/clients/:clientId/meal-proposals",
  auth(["trainer"]),
  controller.createProposal
);
trainerRouter.getAsync(
  "/clients/:clientId/meal-proposals",
  auth(["trainer"]),
  controller.listForClient
);

// Lado cliente — se monta en routes/index.js sin prefijo adicional.
const clientRouter = express.Router();

clientRouter.getAsync(
  "/meal-proposals/mine",
  auth(["admin", "user"]),
  controller.listMine
);
clientRouter.postAsync(
  "/meal-proposals/:id/choose",
  auth(["admin", "user"]),
  controller.chooseAlternative
);

module.exports = { trainerRouter, clientRouter };
