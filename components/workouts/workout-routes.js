const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./workout-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

// Listado global (find({}) paginado): solo admin, devuelve entrenos de todos.
router.getAsync("/", auth(["admin"]), controller.getWorkouts);
router.getAsync("/:id", auth(["admin", "user", "trainer"]), controller.getWorkoutById);
router.postAsync("/", auth(["admin", "user", "trainer"]), controller.createWorkout);
router.postAsync(
  "/add-data-exercise/:idWorkout",
  auth(["admin", "user", "trainer"]),
  controller.addDataExerciseToWorkout,
);
router.postAsync(
  "/multiple/exercises",
  auth(["admin", "user", "trainer"]),
  controller.addExerciseToWorkouts,
);
router.postAsync(
  "/duplicate-row/:idTable/:idWorkout",
  auth(["admin", "user", "trainer"]),
  controller.duplicateWorkoutRow,
);
router.postAsync(
  "/multiple/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.addWorkoutsToSplits,
);
router.postAsync(
  "/date/:id",
  auth(["admin", "user", "trainer"]),
  controller.getWorkoutByIdAndDate,
);
router.putAsync(
  "/names/:idTable/:idWorkout",
  auth(["admin", "user", "trainer"]),
  controller.updateWorkoutsName,
);
router.putAsync(
  "/rows/order/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.reorderWorkoutRows,
);
// Debe declararse ANTES de /:idTable/:idExercise/:workoutOrder (3 segmentos
// todo-parámetro, más abajo) — si no, esa ruta genérica intercepta cualquier
// PUT de 3 segmentos, incluida esta, antes de que Express la alcance.
router.putAsync(
  "/split/:idSplit/order",
  auth(["admin", "user", "trainer"]),
  controller.reorderWorkoutsInSplit,
);
router.putAsync(
  "/:idTable/:idExercise/:workoutOrder",
  auth(["admin", "user", "trainer"]),
  controller.addWorkoutsExercises,
);
router.putAsync(
  "/modify/one/simple/save",
  auth(["admin", "user", "trainer"]),
  controller.modifyWorkout,
);
router.putAsync(
  "/:idWorkout/blocks",
  auth(["admin", "user", "trainer"]),
  controller.updateWorkoutBlocks,
);
router.postAsync(
  "/:idWorkout/copy-to-split/:idSplit",
  auth(["admin", "user", "trainer"]),
  controller.copyWorkoutToSplit,
);
// finish/skip son acciones de "reproducir" el entrenamiento (autoservicio del
// cliente) — deliberadamente NO se abren a "trainer": un profesional
// construye la rutina, no registra las series del cliente en su lugar.
router.putAsync("/finish", auth(["admin", "user"]), controller.finishWorkout);
router.putAsync("/skip", auth(["admin", "user"]), controller.skipWorkout);
router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateWorkout);
router.putAsync(
  "/:idTable/:idWorkout/:idCustomExercise/:idExercise",
  auth(["admin", "user", "trainer"]),
  controller.updateCustomExercises,
);
router.putAsync(
  "/:idWorkout/:idTable",
  auth(["admin", "user", "trainer"]),
  controller.updateWorkoutsOrder,
);
router.putAsync("/deletes", auth(["admin", "user", "trainer"]), controller.deleteWorkouts);
router.putAsync("/paste", auth(["admin", "user", "trainer"]), controller.pasteWorkout);
router.putAsync("/paste-exercises", auth(["admin", "user", "trainer"]), controller.pasteExercises);
router.deleteAsync("/:id", auth(["admin", "user", "trainer"]), controller.deleteWorkout);
router.deleteAsync(
  "/:idWorkout/:idExercise",
  auth(["admin", "user", "trainer"]),
  controller.deleteWorkoutExercise,
);
router.deleteAsync(
  "/all/deletes/:id",
  auth(["admin", "user", "trainer"]),
  controller.deleteWorkoutCustomExercises,
);

module.exports = router;
