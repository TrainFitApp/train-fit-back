const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./custom-exercise-controller");
// const ROLES = require('../users/util/roles');

const router = express.Router();

router.getAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.getCustomExerciseById
);
router.postAsync(
  "/delete/multiple",
  auth(["admin", "user"]),
  controller.deleteCustomExercises
);
router.putAsync("/", auth(["admin", "user"]), controller.updateCustomExercise);
router.putAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.addSetToCustomExercise
);
router.putAsync(
  "/copy/:order",
  auth(["admin", "user"]),
  controller.copySetOnCustomExercise
);
router.deleteAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.deleteCustomExercise
);

module.exports = router;
