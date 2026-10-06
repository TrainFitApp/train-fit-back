const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./split-controller");

const router = express.Router();

// Desde 2026-10 un microciclo solo existe dentro de su rutina (Table.splits):
// se fueron las rutas que creaban microciclos sueltos o los listaban sin
// rutina (ninguna app las llamaba).
router.putAsync(
  "/add/to/table",
  auth(["admin", "user", "trainer"]),
  controller.addSplitToTable,
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
