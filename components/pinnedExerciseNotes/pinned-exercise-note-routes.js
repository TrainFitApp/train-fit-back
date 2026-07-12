const express = require("express");
const router = express.Router();
const PinnedExerciseNoteController = require("./pinned-exercise-note-controller");

router.get("/table/:tableId", PinnedExerciseNoteController.getByTableId);
router.get(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  PinnedExerciseNoteController.getByPosition
);
router.post(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  PinnedExerciseNoteController.upsert
);
router.delete("/:id", PinnedExerciseNoteController.deleteById);
router.delete(
  "/table/:tableId/workout/:workoutIndex/exercise/:exerciseIndex",
  PinnedExerciseNoteController.deleteByPosition
);

module.exports = router;