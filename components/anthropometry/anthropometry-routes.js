const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./anthropometry-controller");

const router = express.Router();

router.postAsync("/", auth(["admin", "user"]), controller.createAnthropometry);
router.getAsync("/:id", auth(["admin", "user"]), controller.getAnthropometryById);
router.postAsync(
  "/by-date",
  auth(["admin", "user"]),
  controller.getAnthropometryByUserIdAndDate
);
router.postAsync(
  "/between-dates",
  auth(["admin", "user"]),
  controller.getAnthropometriesByUserIdBetweenDates
);
router.getAsync("/", auth(["admin", "user"]), controller.getAllAnthropometriesByUserId);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateAnthropometry);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteAnthropometry);
router.postAsync("/upsert", auth(["admin", "user"]), controller.upsertAnthropometry);

module.exports = router;