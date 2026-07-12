const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./workout-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getWorkouts);
router.getAsync("/:id", auth(["admin", "user"]), controller.getWorkoutById);
router.postAsync("/", auth(["admin", "user"]), controller.createWorkout);
router.postAsync(
  "/add-data-exercise/:idWorkout",
  auth(["admin", "user"]),
  controller.addDataExerciseToWorkout,
);
router.postAsync(
  "/multiple/exercises",
  auth(["admin", "user"]),
  controller.addExerciseToWorkouts,
);
router.postAsync(
  "/duplicate-row/:idTable/:idWorkout",
  auth(["admin", "user"]),
  controller.duplicateWorkoutRow,
);
router.postAsync(
  "/multiple/:idTable",
  auth(["admin", "user"]),
  controller.addWorkoutsToSplits,
);
router.postAsync(
  "/date/:id",
  auth(["admin", "user"]),
  controller.getWorkoutByIdAndDate,
);
router.putAsync(
  "/names/:idTable/:idWorkout",
  auth(["admin", "user"]),
  controller.updateWorkoutsName,
);
router.putAsync(
  "/:idTable/:idExercise/:workoutOrder",
  auth(["admin", "user"]),
  controller.addWorkoutsExercises,
);
router.putAsync(
  "/modify/one/simple/save",
  auth(["admin", "user"]),
  controller.modifyWorkout,
);
router.putAsync("/finish", auth(["admin", "user"]), controller.finishWorkout);
router.putAsync("/", auth(["admin", "user"]), controller.updateWorkout);
router.putAsync(
  "/:idTable/:idWorkout/:idCustomExercise/:idExercise",
  auth(["admin", "user"]),
  controller.updateCustomExercises,
);
router.putAsync(
  "/:idWorkout/:idTable",
  auth(["admin", "user"]),
  controller.updateWorkoutsOrder,
);
router.putAsync("/deletes", auth(["admin", "user"]), controller.deleteWorkouts);
router.putAsync("/paste", auth(["admin", "user"]), controller.pasteWorkout);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteWorkout);
router.deleteAsync(
  "/:idWorkout/:idExercise",
  auth(["admin", "user"]),
  controller.deleteWorkoutExercise,
);
router.deleteAsync(
  "/all/deletes/:id",
  auth(["admin", "user"]),
  controller.deleteWorkoutCustomExercises,
);

module.exports = router;
