const express = require("@awaitjs/express");
const router = express.Router();
const { auth } = require("../../middleware/validateAuth");
const controller = require("./pinned-exercise-note-controller");

const ROLES = ["admin", "user", "trainer"];

router.getAsync("/table/:tableId", auth(ROLES), controller.getByTableId);
router.getAsync(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  controller.getByPosition
);
router.postAsync(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  controller.upsert
);
router.deleteAsync("/:id", auth(ROLES), controller.deleteById);
router.deleteAsync(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  controller.deleteByPosition
);

module.exports = router;
