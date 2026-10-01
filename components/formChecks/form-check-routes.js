const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./form-check-controller");

const router = express.Router();
const CLIENT = ["user", "admin"];

// Sin prefijo común (como painRoutes): cliente en /form-checks/mine,
// profesional en /trainer/form-checks. El acceso del profesional a cada
// revisión exige relación de entrenamiento activa con su cliente
// (form-check-service.js#loadForTrainer).
router.postAsync("/form-checks/mine", auth(CLIENT), controller.createMine);
router.getAsync("/form-checks/mine", auth(CLIENT), controller.listMine);
router.postAsync("/form-checks/mine/:id/seen", auth(CLIENT), controller.markSeenMine);
router.deleteAsync("/form-checks/mine/:id", auth(CLIENT), controller.deleteMine);

router.getAsync("/trainer/form-checks", auth(["trainer"]), controller.listForTrainer);
router.getAsync("/trainer/form-checks/pending-count", auth(["trainer"]), controller.pendingCount);
router.getAsync("/trainer/form-checks/:id", auth(["trainer"]), controller.getForTrainer);
router.postAsync("/trainer/form-checks/:id/comments", auth(["trainer"]), controller.addComment);
router.deleteAsync("/trainer/form-checks/:id/comments/:commentId", auth(["trainer"]), controller.removeComment);
router.postAsync("/trainer/form-checks/:id/review", auth(["trainer"]), controller.review);
router.putAsync("/trainer/form-checks/:id/keep", auth(["trainer"]), controller.setKeep);

module.exports = router;
