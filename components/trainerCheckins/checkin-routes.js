const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./checkin-controller");

// Lado trainer — se monta en routes/index.js bajo /trainer.
const trainerRouter = express.Router();

trainerRouter.getAsync("/checkin-fields", auth(["trainer"]), controller.getFieldCatalog);

trainerRouter.getAsync("/checkin-templates", auth(["trainer"]), controller.listDefinitions);
trainerRouter.postAsync("/checkin-templates", auth(["trainer"]), controller.createDefinition);
trainerRouter.putAsync("/checkin-templates/:id", auth(["trainer"]), controller.updateDefinition);
trainerRouter.deleteAsync("/checkin-templates/:id", auth(["trainer"]), controller.deleteDefinition);
trainerRouter.postAsync("/checkin-templates/:id/apply", auth(["trainer"]), controller.applyDefinition);

trainerRouter.getAsync("/checkins/responses", auth(["trainer"]), controller.getMyCheckinResponses);
trainerRouter.getAsync("/checkins/unseen-count", auth(["trainer"]), controller.getUnseenCount);
trainerRouter.postAsync("/checkins/mark-seen", auth(["trainer"]), controller.markSeen);

// Sin requireActiveClient (fuerza un único scope): check-ins son
// transversales a cualquier scope activo — comprobado dentro del service
// (mismo criterio que applyDefinition/listMine/respond).
trainerRouter.getAsync(
  "/clients/:clientId/checkin-config",
  auth(["trainer"]),
  controller.getClientCheckinConfig
);
trainerRouter.getAsync(
  "/clients/:clientId/checkin-responses",
  auth(["trainer"]),
  controller.getClientCheckinResponses
);

// Lado cliente — se monta en routes/index.js sin prefijo adicional.
const clientRouter = express.Router();

clientRouter.getAsync("/checkins/mine", auth(["admin", "user"]), controller.listMine);
clientRouter.getAsync("/checkins/mine/history", auth(["admin", "user"]), controller.listMyHistory);
clientRouter.postAsync("/checkins/:trainerId/respond", auth(["admin", "user"]), controller.respond);

module.exports = { trainerRouter, clientRouter };
