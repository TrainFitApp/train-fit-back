const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./split-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

// Listados y búsquedas globales (sin filtro de dueño): solo admin. Ninguna
// app los usa; con "user" devolvían los microciclos de todo el mundo.
router.getAsync("/", auth(["admin"]), controller.getSplits);
router.getAsync("/code/:barcode", auth(["admin"]), controller.getSplitByCode);
router.getAsync("/count", auth(["admin"]), controller.getSplitsCount);
router.getAsync("/:search", auth(["admin"]), controller.getSearchSplit);
router.postAsync("/", auth(["admin", "user", "trainer"]), controller.createSplit);
router.postAsync(
  "/:tableInUseId",
  auth(["admin", "user", "trainer"]),
  controller.createSplitAndAddToTable,
);
router.putAsync(
  "/add/to/table",
  auth(["admin", "user", "trainer"]),
  controller.addSplitToTable,
);
router.putAsync(
  "/split/:idTable/:idSplit",
  auth(["admin", "user", "trainer"]),
  controller.addTableSplit,
);
router.putAsync(
  "/:idSplit/:idWorkout",
  auth(["admin", "user", "trainer"]),
  controller.addWorkoutsSplit,
);
router.putAsync("/:id", auth(["admin", "user", "trainer"]), controller.updateSplit);
router.putAsync(
  "/rows/order/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.reorderSplits,
);
router.postAsync(
  "/blank/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.createBlankSplitAndAddToTable,
);
router.deleteAsync(
  "/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.deleteSplits,
);
router.deleteAsync(
  "/:idTable/:idSplit",
  auth(["admin", "user", "trainer"]),
  controller.deleteSplit,
);

module.exports = router;
