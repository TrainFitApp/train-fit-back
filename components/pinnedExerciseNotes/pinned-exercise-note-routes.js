const express = require("express");
const router = express.Router();
const { auth } = require("../../middleware/validateAuth");
const PinnedExerciseNoteController = require("./pinned-exercise-note-controller");

const ROLES = ["admin", "user", "trainer"];

router.get("/table/:tableId", auth(ROLES), PinnedExerciseNoteController.getByTableId);
router.get(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  PinnedExerciseNoteController.getByPosition
);
router.post(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  PinnedExerciseNoteController.upsert
);
router.delete("/:id", auth(ROLES), PinnedExerciseNoteController.deleteById);
router.delete(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  auth(ROLES),
  PinnedExerciseNoteController.deleteByPosition
);

module.exports = router;
