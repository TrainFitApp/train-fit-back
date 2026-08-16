const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-template-controller");

const router = express.Router();

router.getAsync("/diet-templates", auth(["trainer"]), controller.list);
router.postAsync("/diet-templates", auth(["trainer"]), controller.create);
router.getAsync("/diet-templates/:id", auth(["trainer"]), controller.getById);
router.putAsync("/diet-templates/:id", auth(["trainer"]), controller.updateMetadata);
router.deleteAsync("/diet-templates/:id", auth(["trainer"]), controller.remove);

router.postAsync("/diet-templates/:id/days", auth(["trainer"]), controller.addDay);
router.putAsync(
  "/diet-templates/:id/days/order",
  auth(["trainer"]),
  controller.reorderDays
);
router.putAsync(
  "/diet-templates/:id/days/:dayIndex",
  auth(["trainer"]),
  controller.renameDay
);
router.deleteAsync(
  "/diet-templates/:id/days/:dayIndex",
  auth(["trainer"]),
  controller.deleteDay
);

router.postAsync(
  "/diet-templates/:id/days/:dayIndex/meals",
  auth(["trainer"]),
  controller.addMeal
);
router.deleteAsync(
  "/diet-templates/:id/days/:dayIndex/meals/:mealId",
  auth(["trainer"]),
  controller.removeMeal
);

router.postAsync(
  "/diet-templates/:id/meals/:mealId/products",
  auth(["trainer"]),
  controller.addCustomProduct
);
router.deleteAsync(
  "/diet-templates/:id/meals/:mealId/products/:customProductId",
  auth(["trainer"]),
  controller.removeCustomProduct
);

module.exports = router;
