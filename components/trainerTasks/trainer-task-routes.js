const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./trainer-task-controller");

// Lado trainer — se monta en routes/index.js bajo /trainer.
const trainerRouter = express.Router();

trainerRouter.postAsync(
  "/clients/:clientId/tasks",
  auth(["trainer"]),
  controller.createForClient
);
trainerRouter.getAsync(
  "/clients/:clientId/tasks",
  auth(["trainer"]),
  controller.listForClient
);
trainerRouter.putAsync("/tasks/:id", auth(["trainer"]), controller.update);
trainerRouter.putAsync("/tasks/:id/active", auth(["trainer"]), controller.setActive);

// Lado cliente — se monta en routes/index.js sin prefijo adicional.
const clientRouter = express.Router();

clientRouter.getAsync("/tasks/mine", auth(["admin", "user"]), controller.listMine);
clientRouter.getAsync("/tasks/completions", auth(["admin", "user"]), controller.listCompletions);
clientRouter.putAsync("/tasks/:id/completion", auth(["admin", "user"]), controller.setCompletion);

module.exports = { trainerRouter, clientRouter };
