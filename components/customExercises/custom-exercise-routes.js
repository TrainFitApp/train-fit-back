const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./custom-exercise-controller");
// const ROLES = require('../users/util/roles');

const router = express.Router();

router.getAsync(
  "/:id",
  auth(["admin", "user", "trainer"]),
  controller.getCustomExerciseById
);
router.postAsync(
  "/delete/multiple",
  auth(["admin", "user", "trainer"]),
  controller.deleteCustomExercises
);
router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateCustomExercise);
router.putAsync(
  "/:id",
  auth(["admin", "user", "trainer"]),
  controller.addSetToCustomExercise
);
router.putAsync(
  "/copy/:order",
  auth(["admin", "user", "trainer"]),
  controller.copySetOnCustomExercise
);
router.putAsync(
  "/:id/block",
  auth(["admin", "user", "trainer"]),
  controller.setCustomExerciseBlock
);
router.deleteAsync(
  "/:id",
  auth(["admin", "user", "trainer"]),
  controller.deleteCustomExercise
);

module.exports = router;
