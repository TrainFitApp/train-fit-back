const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./diet-days-controller");
const ROLES = require("../users/util/roles");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.getDietDays);
router.postAsync(
  "/weights/between/:id",
  auth(["admin", "user"]),
  controller.getDietDaysWeightsBetweenDatesByIdDiet,
);
router.postAsync(
  "/between/:id",
  auth(["admin", "user"]),
  controller.getDietDaysBetweenDatesByIdDiet,
);
router.postAsync(
  "/date/:id",
  auth(["admin", "user"]),
  controller.getDietDayByIdDietAndDate,
);
router.postAsync("/", auth(["admin", "user"]), controller.createDietDay);
router.postAsync(
  "/create/on/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createDayWeightOnNewDietDay,
);
router.postAsync(
  "/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomProductOnNewDietDay,
);
router.postAsync(
  "/create/recipe/new/:dietInUseId",
  auth(["admin", "user"]),
  controller.createCustomRecipeOnNewDietDay,
);
router.postAsync(
  "/recipe/own/:idUser",
  auth(["admin", "user"]),
  controller.createOwnCustomRecipeOnNewDietDay,
);
router.putAsync("/:id", auth(["admin", "user"]), controller.updateDietDay);
router.putAsync(
  "/:idDietDay/:idMeal",
  auth(["admin", "user"]),
  controller.addDietDayMeal,
);
router.putAsync(
  "/copy/paste/:id",
  auth(["admin", "user"]),
  controller.pasteDietDayByIdDiet,
);
router.deleteAsync(
  "/:idDiet/:idDietDay",
  auth(["admin", "user"]),
  controller.deleteDietDay,
);
router.deleteAsync(
  "/:id",
  auth(["admin", "user"]),
  controller.deleteDietDayMeal,
);

module.exports = router;
