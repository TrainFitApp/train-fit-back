const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./split-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getSplits);
router.getAsync(
  "/code/:barcode",
  auth(["admin", "user"]),
  controller.getSplitByCode,
);
router.getAsync("/count", auth(["admin", "user"]), controller.getSplitsCount);
router.getAsync("/:search", auth(["admin", "user"]), controller.getSearchSplit);
router.postAsync("/", auth(["admin", "user"]), controller.createSplit);
router.postAsync(
  "/:tableInUseId",
  auth(["admin", "user"]),
  controller.createSplitAndAddToTable,
);
router.putAsync(
  "/add/to/table",
  auth(["admin", "user"]),
  controller.addSplitToTable,
);
router.putAsync(
  "/split/:idTable/:idSplit",
  auth(["admin", "user"]),
  controller.addTableSplit,
);
router.putAsync(
  "/:idSplit/:idWorkout",
  auth(["admin", "user"]),
  controller.addWorkoutsSplit,
);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateSplit);
router.deleteAsync(
  "/:idTable",
  auth(["admin", "user"]),
  controller.deleteSplits,
);
router.deleteAsync(
  "/:idTable/:idSplit",
  auth(["admin", "user"]),
  controller.deleteSplit,
);

module.exports = router;
